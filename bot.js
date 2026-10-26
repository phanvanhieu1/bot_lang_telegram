require('dotenv').config();
const { Telegraf } = require('telegraf');
const crypto = require('node:crypto');
const { withDownloadedVoice } = require('./telegram-media');
const { copyInlineButton, splitLongText } = require('./telegram-utils');
const { exportAnkiCsv } = require('./telegram-vocabulary');
const { translateViaSharedCache, ready: sharedDbReady } = require('./telegram-sync/cache');
const { connectTelegram, findLinkedUser } = require('./telegram-sync/link');
const { saveLinkedVocabulary, exportLinkedVocabulary } = require('./telegram-sync/vocabulary');
const connectDatabase = require('./config/database');
const { MAIN_MENU, replyMenuOptions } = require('./telegram-main-menu');
const { parseTelegramTranslation, buildTranslationButtons, buildCompactTranslation, getChineseSentence, getSpeechLanguage } = require('./telegram-translation');

// Import Modules
const { Markup } = require('telegraf'); // Đảm bảo import Markup
const { getUserConfig, saveDatabase, isAuthorized, addAuthorizedUser, removeAuthorizedUser, getWhitelist, saveVocabulary, getVocabulary, clearVocabulary } = require('./session');
const { getCachedText, setCachedText, getCachedAudio, setCachedAudio, clearAudioCache } = require('./cache');
const { LANG_CONFIG, VOICES, SPEED_OPTIONS } = require('./config');
const MASTER_ADMIN = process.env.MASTER_ADMIN;
const TEST_MODE = process.env.TELEGRAM_TEST_MODE === '1';
const { renderDashboard, renderMenu, renderDisplayMenu, getSpeedKey } = require('./ui');
const { translateFull, transcribeVoice, generateSpeech, generatePinyin } = require('./ai');
const { resolveBotSpeech } = require('./ai/services/speech.service');
const handleError = require('./errorHandler');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const activeSpeechRequests = new Set(); // prevent duplicate ElevenLabs calls on repeated taps
// ==========================================
// CÀI ĐẶT MENU BUTTON TỰ ĐỘNG CHO TELEGRAM
// ==========================================
const BOT_COMMANDS = [
  { command: 'start', description: '🏠 Mở Bảng điều khiển Cài đặt' },
  { command: 'export', description: '💾 Xuất Sổ tay từ vựng ra file CSV' },
  { command: 'clearvocab', description: '🗑 Xóa sạch Sổ tay từ vựng' },
  { command: 'clearcache', description: '🧹 Xóa cache audio (chỉ Admin)' },
  { command: 'listusers', description: '📋 Xem danh sách người dùng (Chỉ Admin)' },
  { command: 'settings', description: '⚙️ Cài đặt dịch thuật' },
  { command: 'menu', description: '📱 Hiển thị menu chức năng' },
  { command: 'newchat', description: '🆕 Xóa ngữ cảnh hội thoại hiện tại' },
  { command: 'link', description: '🔗 Liên kết với tài khoản web PRO' }
];
// ==========================================
// 1. MIDDLEWARE: BẢO VỆ BOT (CHẶN NGƯỜI LẠ)
// ==========================================
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  const userId = ctx.from.id.toString();

  // Mặc định: Trùm cuối luôn có quyền và tự động được thêm vào Whitelist
  if (userId === MASTER_ADMIN) {
    addAuthorizedUser(userId);
    return next(); 
  }

  // Kiểm tra khách lạ
  if (isAuthorized(userId)) {
    return next(); // Có trong danh sách -> Cho phép đi tiếp
  } else {
    // Không có trong danh sách -> Báo lỗi và chặn
    if (ctx.message && ctx.message.text) {
      await ctx.reply('⛔ *Truy cập bị từ chối!*\nBot này là hệ thống cá nhân. Bạn chưa được cấp quyền sử dụng.', { parse_mode: 'Markdown' });
    }
  }
});

// ==========================================
// 2. CÁC LỆNH DÀNH RIÊNG CHO ADMIN
// ==========================================
bot.command('adduser', async (ctx) => {
  if (ctx.from.id.toString() !== MASTER_ADMIN) return;
  
  const args = ctx.message.text.split(' ');
  const newId = args[1];
  if (!/^\d{5,20}$/.test(newId || '')) return ctx.reply('⚠️ Cú pháp: /adduser <Telegram_ID dạng số>');
  addAuthorizedUser(newId);
  await ctx.reply(`✅ Đã cấp quyền sử dụng Bot cho ID: \`${newId}\``, { parse_mode: 'Markdown' });
});

bot.command('removeuser', async (ctx) => {
  if (ctx.from.id.toString() !== MASTER_ADMIN) return;
  
  const args = ctx.message.text.split(' ');
  const targetId = args[1];
  if (!/^\d{5,20}$/.test(targetId || '')) return ctx.reply('⚠️ Cú pháp: /removeuser <Telegram_ID dạng số>');
  if (targetId === MASTER_ADMIN) return ctx.reply('❌ Bạn không thể tự xóa quyền của chính mình!');
  
  removeAuthorizedUser(targetId);
  await ctx.reply(`🗑 Đã thu hồi quyền sử dụng Bot của ID: \`${targetId}\``, { parse_mode: 'Markdown' });
});

bot.command('listusers', async (ctx) => {
  if (ctx.from.id.toString() !== MASTER_ADMIN) return;
  const wl = getWhitelist();
  for (const chunk of splitLongText('📋 DANH SÁCH ĐƯỢC CẤP QUYỀN:\n\n' + wl.map((id, i) => `${i+1}. ${id}`).join('\n'))) await ctx.reply(chunk);
});

// --- PERSISTENT TELEGRAM REPLY KEYBOARD ---
async function sendSettings(ctx) {
  const { text, keyboard } = renderDashboard(getUserConfig(ctx.from.id));
  return ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
}

async function showMainMenu(ctx) {
  const marker = TEST_MODE ? '🧪 BOT THỬ NGHIỆM\n\n' : '';
  return ctx.reply(marker + '📖 Gửi văn bản, ảnh hoặc ghi âm để dịch. Chọn chức năng ở menu dưới ô nhập.', replyMenuOptions());
}

bot.start(showMainMenu);
bot.command('menu', showMainMenu);
bot.command('settings', sendSettings);

// The reply keyboard sends text messages, unlike per-translation inline buttons.
// Register before bot.on('text') so menu labels cannot go through paid translation.
bot.hears(MAIN_MENU.translate, ctx => ctx.reply('📖 Chế độ dịch đã sẵn sàng. Hãy gửi câu, ảnh hoặc ghi âm.'));
bot.hears(MAIN_MENU.settings, sendSettings);
bot.hears(MAIN_MENU.voice, ctx =>
  { const c = getUserConfig(ctx.from.id);
    const { text, keyboard } = renderMenu('🎙 *CHỌN GIỌNG TIẾNG TRUNG*', VOICES, c.voiceKey, 'set_voice');
    return ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  }
);
bot.hears(MAIN_MENU.vocabulary, ctx => ctx.reply('📚 Kho từ vựng đang được phát triển. Bạn vẫn có thể lưu bằng 💾 và dùng /export để xuất CSV.'));
bot.hears(MAIN_MENU.practice, ctx => ctx.reply('📝 Chức năng luyện tập đang được phát triển.'));
bot.hears(MAIN_MENU.statistics, ctx => ctx.reply('📊 Thống kê học tập đang được phát triển.'));

const editMenu = async (ctx, renderData) => {
  const options = { parse_mode: 'Markdown', ...renderData.keyboard };
  try {
    await ctx.editMessageText(renderData.text, options);
  } catch (error) {
    const reason = String(error?.description || error?.message || '');
    if (!/message is not modified/i.test(reason)) {
      if (/message to edit not found|message can't be edited|message identifier is not specified|MESSAGE_ID_INVALID/i.test(reason)) {
        // Old/deleted inline settings message: open a fresh editable menu.
        await ctx.reply(renderData.text, options);
      } else {
        throw error;
      }
    }
  }
  await ctx.answerCbQuery();
};

bot.action('menu_main', (ctx) => editMenu(ctx, renderDashboard(getUserConfig(ctx.from.id))));
bot.action('menu_lang', (ctx) => editMenu(ctx, renderMenu('🌐 *CHỌN NGÔN NGỮ*', LANG_CONFIG, getUserConfig(ctx.from.id).targetLang, 'set_lang')));
bot.action('menu_voice', (ctx) => editMenu(ctx, renderMenu('🎙 *CHỌN GIỌNG ĐỌC*', VOICES, getUserConfig(ctx.from.id).voiceKey, 'set_voice')));
bot.action('menu_speed', (ctx) => editMenu(ctx, renderMenu('⏩ *CHỌN TỐC ĐỘ*', SPEED_OPTIONS, getSpeedKey(getUserConfig(ctx.from.id).speed), 'set_speed')));
bot.action('menu_display', (ctx) => editMenu(ctx, renderDisplayMenu(getUserConfig(ctx.from.id))));
bot.action('menu_close', async (ctx) => { try { await ctx.deleteMessage(); } catch(e){} await ctx.answerCbQuery('Đã đóng'); });

// Thay đổi Ngôn ngữ / Giọng đọc / Tốc độ
bot.action(/^set_(lang|voice|speed)_([a-zA-Z0-9.]+)$/, async (ctx) => {
  const [type, val] = [ctx.match[1], ctx.match[2]];
  const allowed = { lang: LANG_CONFIG, voice: VOICES, speed: SPEED_OPTIONS };
  if (!Object.prototype.hasOwnProperty.call(allowed[type], val)) {
    return ctx.answerCbQuery('Tùy chọn không hợp lệ.');
  }
  const c = getUserConfig(ctx.from.id);
  const keyMap = { lang: 'targetLang', voice: 'voiceKey', speed: 'speed' };
  const actualVal = type === 'speed' ? Number(val) : val;
  
  if (c[keyMap[type]] === actualVal) return ctx.answerCbQuery('Đang chọn mục này rồi!');
  
  c[keyMap[type]] = actualVal;
  saveDatabase(); // <--- THÊM DÒNG NÀY ĐỂ LƯU VĨNH VIỄN
  
  const renderFunc = type === 'lang' ? renderMenu('🌐 *CHỌN NGÔN NGỮ*', LANG_CONFIG, c.targetLang, 'set_lang') : 
                     type === 'voice' ? renderMenu('🎙 *CHỌN GIỌNG ĐỌC*', VOICES, c.voiceKey, 'set_voice') : 
                     renderMenu('⏩ *CHỌN TỐC ĐỘ*', SPEED_OPTIONS, getSpeedKey(c.speed), 'set_speed');
  await editMenu(ctx, renderFunc);
});

// Only vocabulary analysis remains configurable in the compact interface.
bot.action(/^toggle_(pron|back|vocab)$/, async (ctx) => {
  const c = getUserConfig(ctx.from.id);
  const field = { pron: 'showPronunciation', back: 'showBackTranslation', vocab: 'showVocabulary' }[ctx.match[1]];
  c[field] = !c[field];
  saveDatabase();
  await editMenu(ctx, renderDisplayMenu(c));
});

// Legacy setting buttons are no longer used; speech is generated on demand.
bot.action('toggle_voice', ctx => ctx.answerCbQuery('Hãy bấm 🔊 dưới bản dịch để tạo âm thanh.'));
bot.action('toggle_trans', ctx => ctx.answerCbQuery('Bản dịch chính luôn hiển thị. Có thể bật/tắt Pinyin, dịch ngược và từ vựng.'));

// Only the logged-in website can issue a short-lived linking code.
// Telegram ID alone is not enough to identify an account on the website.
bot.command('link', async (ctx) => {
  if (ctx.chat?.type !== 'private') return ctx.reply('🔒 Chỉ liên kết tài khoản trong tin nhắn riêng với bot.');
  if (!sharedDbReady()) return ctx.reply('⚠️ Bot chưa kết nối MongoDB chung với website.');
  const parts = String(ctx.message?.text || '').trim().split(/\s+/);
  if (parts.length === 1) {
    const account = await findLinkedUser(ctx.from.id);
    return ctx.reply(account
      ? '✅ Telegram đã liên kết với tài khoản web PRO. Bạn có thể lưu từ vựng bằng 💾.'
      : '🔗 Mở /telegram/connect trên website sau khi đăng nhập PRO, tạo mã một lần rồi gửi: /link MÃ');
  }
  const outcome = await connectTelegram(ctx.from.id, parts[1]);
  return ctx.reply(outcome.ok
    ? '✅ Liên kết thành công! Từ vựng mới lưu bằng 💾 sẽ vào kho học tập trên web.'
    : '⚠️ Liên kết không thành công. Mã có thể đã hết hạn, đã sử dụng hoặc tài khoản đã liên kết với Telegram khác.');
});

// Each Save button refers to the vocabulary of THAT translation, not the latest.
bot.action(/^save_vocab_([a-f0-9]{12})$/, async (ctx) => {
  const c = getUserConfig(ctx.from.id);
  const key = ctx.match[1];
  const item = c.pendingVocabs?.[key];
  if (!item) return ctx.answerCbQuery('Từ vựng này đã được lưu hoặc hết hạn.');
  if (!sharedDbReady()) return ctx.answerCbQuery('Chưa có MongoDB chung. Không thể lưu.', { show_alert: true });

  try {
    const result = await saveLinkedVocabulary(ctx.from.id, {
      chineseText: typeof item === 'object' ? item.chineseText : '',
      vocabulary: typeof item === 'object' ? item.vocabulary : ''
    });
    if (!result.linked) {
      return ctx.answerCbQuery('Hãy liên kết tài khoản web PRO bằng /link trước.', { show_alert: true });
    }
    delete c.pendingVocabs[key];
    saveDatabase();
    await ctx.answerCbQuery(`✅ Đã đồng bộ ${result.saved} mục vào kho từ vựng web!`);
    try {
      const rows = (ctx.callbackQuery?.message?.reply_markup?.inline_keyboard || [])
        .map(row => row.map(button => button.callback_data === 'save_vocab_' + key
          ? Markup.button.callback('✅', 'noop') : button));
      if (rows.length) await ctx.editMessageReplyMarkup({ inline_keyboard: rows });
    } catch (error) {
      if (!/message is not modified/i.test(error?.message || '')) {
        console.warn('Telegram save button update:', error.message);
      }
    }
  } catch (error) {
    console.error('Shared vocabulary save failed:', error.message);
    await ctx.answerCbQuery('Không thể lưu MongoDB lúc này. Hãy thử lại.', { show_alert: true });
  }
});


// The callback resolves the exact translated sentence that produced this button.
bot.action(/^speak_translation_([a-f0-9]{12})$/, async (ctx) => {
  const c = getUserConfig(ctx.from.id);
  const record = c.pendingSpeech?.[ctx.match[1]];
  if (!record || !record.text || typeof record.at !== 'number' ||
      Date.now() - record.at > 7 * 24 * 60 * 60 * 1000) {
    return ctx.answerCbQuery('Bản dịch này đã hết hạn. Hãy dịch lại.');
  }
  if (record.text.length > 500) {
    return ctx.answerCbQuery('Giọng đọc chỉ hỗ trợ câu tối đa 500 ký tự.', { show_alert: true });
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    return ctx.answerCbQuery('Chưa cấu hình ElevenLabs cho bot này.', { show_alert: true });
  }
  const requestKey = ctx.from.id + ':' + ctx.match[1];
  if (activeSpeechRequests.has(requestKey)) {
    return ctx.answerCbQuery('Âm thanh cho câu này đang được tạo.');
  }
  activeSpeechRequests.add(requestKey);
  try {
    await ctx.answerCbQuery('🔊 Đang tạo âm thanh...');
    // Use current voice/speed settings, but preserve the original sentence.
    const voiceKey = record.language === 'vi' ? 'vi' : c.voiceKey;
    const speed = c.speed;
    // The cache key includes actual model, voice ID and forced language.
    // A legacy Vietnamese MP3 with incorrect accent must never be reused.
    const ttsRequest = resolveBotSpeech(record.text, voiceKey, speed);
    let audio = getCachedAudio(record.text, ttsRequest.cacheVoice, speed);
    if (!audio) {
      audio = await generateSpeech(record.text, voiceKey, speed);
      setCachedAudio(record.text, ttsRequest.cacheVoice, speed, audio);
    }
    await ctx.replyWithVoice({ source: audio, filename: 'translation.mp3' });
  } catch (error) {
    console.warn('Telegram on-demand TTS error:', error?.status || error?.code || error?.message);
    await ctx.reply('⚠️ Không thể tạo âm thanh lúc này. Bạn có thể thử lại bằng nút 🔊.');
  } finally {
    activeSpeechRequests.delete(requestKey);
  }
});

// Old buttons cannot be linked reliably to a particular translation.
bot.action('save_vocab', ctx => ctx.answerCbQuery('Hãy dịch lại câu này để lưu đúng từ vựng.'));
bot.action('noop', ctx => ctx.answerCbQuery());

// Lệnh xuất sổ tay từ vựng ra file CSV
bot.command('export', async (ctx) => {
  if (!sharedDbReady()) return ctx.reply('⚠️ Chưa kết nối MongoDB chung với web.');
  try {
    const data = await exportLinkedVocabulary(ctx.from.id);
    if (!data.linked) return ctx.reply('🔗 Hãy liên kết với tài khoản web PRO bằng /link trước.');
    if (!data.count) return ctx.reply('📭 Kho từ vựng web của bạn chưa có mục nào.');
    await ctx.replyWithDocument(
      { source: Buffer.from(data.csv, 'utf8'), filename: 'Web_PRO_Vocabulary.csv' },
      { caption: `📚 Đã xuất ${data.count} mục từ vựng từ MongoDB chung với website.` }
    );
  } catch (error) {
    console.error('Shared vocabulary export failed:', error.message);
    await ctx.reply('⚠️ Không thể xuất kho từ vựng lúc này.');
  }
});

// Clearing Telegram-local legacy data must never delete personal web entries.
bot.command('clearvocab', async (ctx) => {
  await ctx.reply('🔒 Kho từ vựng MongoDB được dùng chung với web. Để xóa mục, hãy mở Kho học tập trên website. Lệnh này không xóa dữ liệu dùng chung.');
});

bot.command('newchat', async (ctx) => {
  const c = getUserConfig(ctx.from.id);
  c.history = [];
  saveDatabase();
  await ctx.reply('🆕 Đã xóa ngữ cảnh hội thoại. Bản dịch tiếp theo sẽ bắt đầu cuộc trò chuyện mới.');
});

bot.command('clearcache', async (ctx) => {
  if (ctx.from.id.toString() !== MASTER_ADMIN) return ctx.reply('⛔ Chỉ admin được xóa cache âm thanh dùng chung.');
  const removed = clearAudioCache();
  await ctx.reply(`🧹 Đã xóa ${removed} file âm thanh trong cache. Cache dịch web và từ vựng được giữ nguyên.`);
});

// --- CORE PROCESSOR: XỬ LÝ CHUNG CHO VĂN BẢN, ẢNH, GIỌNG NÓI ---
async function processStudyContent(ctx, text = '', imageUrl = null, statusMsgPrefix = '⏳ Đang phân tích') {
  const c = getUserConfig(ctx.from.id);
  // Telegram always produces the compact translation + Pinyin + back translation format.
  const isFast = false;
  let statusMsg = null;
  try {
    statusMsg = await ctx.reply(`${statusMsgPrefix}...`);
    // Share the exact same PRO MongoDB translation cache as the web.
    // Text requests are stateless, matching the web's context='auto' cache.
    // Photos cannot be keyed by raw text and are never shared-cached.
    let parsed;
    if (text && !imageUrl && sharedDbReady()) {
      parsed = await translateViaSharedCache(text, c.targetLang, c.showVocabulary);
    } else {
      const raw = await translateFull(text, c.targetLang, false, imageUrl, [], false, {
        telegramMode: true, backTranslation: true, vocabulary: c.showVocabulary
      });
      parsed = parseTelegramTranslation(raw);
    }

    const translatedText = parsed.translation;
    const chineseText = getChineseSentence(text, translatedText, parsed.backTranslation);
    const pinyin = chineseText && c.targetLang === 'zh' && c.showPronunciation ? generatePinyin(chineseText) : '';
    const combinedText = buildCompactTranslation({
      translation: translatedText,
      pinyin,
      backTranslation: c.showBackTranslation ? parsed.backTranslation : ''
    });

    const nonce = crypto.randomBytes(6).toString('hex');
    c.pendingSpeech[nonce] = {
      text: translatedText,
      language: getSpeechLanguage(text, translatedText, c.targetLang),
      at: Date.now()
    };
    for (const old of Object.keys(c.pendingSpeech).slice(0, -30)) delete c.pendingSpeech[old];

    let vocabId = null;
    if (!isFast && c.showVocabulary && parsed.vocabulary) {
      vocabId = nonce;
      c.pendingVocabs[vocabId] = { vocabulary: parsed.vocabulary, chineseText };
      for (const old of Object.keys(c.pendingVocabs).slice(0, -30)) delete c.pendingVocabs[old];
    }
    saveDatabase();

    const actions = buildTranslationButtons({
      translation: translatedText,
      speechId: nonce,
      vocabId,
      copyInlineButton,
      callbackButton: Markup.button.callback
    });

    // Translation / Pinyin / back translation remain together.
    const mainMessages = splitLongText(combinedText);
    for (const [index, message] of mainMessages.entries()) {
      await ctx.reply(message, index === 0 ? { reply_markup: actions } : {});
    }
    // Vocabulary, when enabled, is a separate Telegram message.
    if (c.showVocabulary && parsed.vocabulary) {
      for (const message of splitLongText('📝 Từ vựng:\n' + parsed.vocabulary)) {
        await ctx.reply(message);
      }
    }

  } catch (error) {
    await handleError(error, ctx);
  } finally {
    if (statusMsg?.message_id) {
      try { await ctx.deleteMessage(statusMsg.message_id); } catch {}
    }
  }
}

// --- MESSAGE HANDLERS: NHẬN SỰ KIỆN ĐẦU VÀO ---
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  if (Object.values(MAIN_MENU).includes(ctx.message.text)) return;
  await processStudyContent(ctx, ctx.message.text.trim(), null, '⏳ Đang phân tích văn bản');
});

bot.on('photo', async (ctx) => {
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    await processStudyContent(ctx, (ctx.message.caption || '').trim(), fileLink.href, '🖼 Đang phân tích hình ảnh');
  } catch (error) {
    await handleError(error, ctx);
  }
});

bot.on('voice', async (ctx) => {
  let status = null;
  try {
    status = await ctx.reply('🎙 Đang nghe và nhận diện giọng nói...');
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const spokenText = await withDownloadedVoice(fileLink.href, transcribeVoice);
    if (spokenText) {
      // No Markdown parse mode: user speech may contain arbitrary punctuation.
      for (const chunk of splitLongText('🎤 Nhận diện: ' + spokenText)) await ctx.reply(chunk);
      await processStudyContent(ctx, spokenText, null, '⏳ Đang phân tích câu nói');
    } else {
      await ctx.reply('⚠️ Không nhận diện được nội dung ghi âm.');
    }
  } catch (error) {
    await handleError(error, ctx);
  } finally {
    if (status?.message_id) {
      try { await ctx.deleteMessage(status.message_id); } catch {}
    }
  }
});

bot.catch(async (error, ctx) => {
  console.error('Telegram bot handler error:', error?.message || error);
  try { await ctx.reply('❌ Có lỗi khi xử lý yêu cầu. Vui lòng thử lại.'); } catch {}
});

async function launchTelegramBot() {
  if (process.env.MONGODB_URI && !sharedDbReady()) {
    await connectDatabase();
  } else if (!process.env.MONGODB_URI) {
    console.warn('⚠️ MongoDB chung chưa cấu hình: cache web và lưu từ vựng web chưa khả dụng.');
  }
  await bot.launch();
  console.log('🚀 Telegram bot đã khởi chạy');
  try { await bot.telegram.setMyCommands(BOT_COMMANDS); } catch (error) {
    console.warn('Không thể cập nhật menu Telegram:', error.message);
  }
}

if (require.main === module) {
  launchTelegramBot().catch(error => {
    console.error('Không thể khởi chạy Telegram bot:', error.message);
    process.exitCode = 1;
  });
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { bot, launchTelegramBot };
