require('dotenv').config();
const { Telegraf } = require('telegraf');
const crypto = require('node:crypto');
const { withDownloadedVoice } = require('./telegram-media');
const { buildStudyMessages, copyInlineButton, splitLongText } = require('./telegram-utils');
const { exportAnkiCsv } = require('./telegram-vocabulary');
const { parseTelegramTranslation, buildTranslationButtons } = require('./telegram-translation');

// Import Modules
const { Markup } = require('telegraf'); // Đảm bảo import Markup
const { getUserConfig, saveDatabase, isAuthorized, addAuthorizedUser, removeAuthorizedUser, getWhitelist, saveVocabulary, getVocabulary, clearVocabulary } = require('./session');
const { getCachedText, setCachedText, getCachedAudio, setCachedAudio, clearAudioCache } = require('./cache');
const { LANG_CONFIG, VOICES, SPEED_OPTIONS } = require('./config');
const MASTER_ADMIN = process.env.MASTER_ADMIN;
const TEST_MODE = process.env.TELEGRAM_TEST_MODE === '1';
const { renderDashboard, renderMenu, renderDisplayMenu, getSpeedKey } = require('./ui');
const { translateFull, transcribeVoice, generateSpeech } = require('./ai');
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
  { command: 'newchat', description: '🆕 Xóa ngữ cảnh hội thoại hiện tại' }
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

// --- CÁC LỆNH MENU TELEGRAM ---
bot.start(async (ctx) => {
  const { text, keyboard } = renderDashboard(getUserConfig(ctx.from.id));
  await ctx.reply(`${TEST_MODE ? '🧪 *BOT THỬ NGHIỆM*\n\n' : ''}👋 *Chào mừng bạn tới Bot AI (Modular Architecture)!*\nBạn có thể Gõ chữ, Gửi ảnh hoặc Ghi âm để bot dịch thuật.\n\n👉 Bấm /settings để mở cài đặt.`, { parse_mode: 'Markdown' });
  await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.command('settings', async (ctx) => {
  const { text, keyboard } = renderDashboard(getUserConfig(ctx.from.id));
  await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
});

const editMenu = async (ctx, renderData) => {
  try {
    await ctx.editMessageText(renderData.text, { parse_mode: 'Markdown', ...renderData.keyboard });
  } catch (error) {
    if (!/message is not modified/i.test(error?.message || '')) throw error;
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
bot.action(/set_(lang|voice|speed)_(.+)/, async (ctx) => {
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

// Bật/Tắt Hiển thị và Âm thanh
bot.action(/toggle_(trans|pron|vocab)/, async (ctx) => {
  const c = getUserConfig(ctx.from.id);
  const map = { trans: 'showTranslation', pron: 'showPronunciation', vocab: 'showVocabulary' };
  
  c[map[ctx.match[1]]] = !c[map[ctx.match[1]]];
  saveDatabase();
  
  await editMenu(ctx, renderDisplayMenu(c));
});

// Legacy setting buttons are no longer used; speech is generated on demand.
bot.action('toggle_voice', ctx => ctx.answerCbQuery('Hãy bấm 🔊 dưới bản dịch để tạo âm thanh.'));

// Each Save button refers to the vocabulary of THAT translation, not the latest.
bot.action(/^save_vocab_([a-f0-9]{12})$/, async (ctx) => {
  const c = getUserConfig(ctx.from.id);
  const key = ctx.match[1];
  const vocabulary = c.pendingVocabs?.[key];
  if (!vocabulary) return ctx.answerCbQuery('Mục này đã được lưu hoặc hết hạn.');
  const saved = saveVocabulary(ctx.from.id, vocabulary);
  delete c.pendingVocabs[key];
  saveDatabase();
  await ctx.answerCbQuery(saved ? `✅ Đã lưu ${saved} mục từ vựng!` : 'Các từ này đã có trong sổ tay.');
  try {
    const oldRows = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard || [];
    const rows = oldRows.map(row => row.map(button =>
      button.callback_data === 'save_vocab_' + key
        ? Markup.button.callback('✅', 'noop')
        : button
    ));
    if (rows.length) await ctx.editMessageReplyMarkup({ inline_keyboard: rows });
  } catch (error) {
    if (!/message is not modified/i.test(error?.message || '')) {
      console.warn('Telegram update save button:', error.message);
    }
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
    const voiceKey = c.voiceKey;
    const speed = c.speed;
    let audio = getCachedAudio(record.text, voiceKey, speed);
    if (!audio) {
      audio = await generateSpeech(record.text, voiceKey, speed);
      setCachedAudio(record.text, voiceKey, speed, audio);
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
  const vocabs = getVocabulary(ctx.from.id);
  if (vocabs.length === 0) return ctx.reply('📭 Sổ tay của bạn đang trống!');

  const csvContent = exportAnkiCsv(vocabs);
  const buffer = Buffer.from(csvContent, 'utf-8');
  
  await ctx.replyWithDocument(
    { source: buffer, filename: 'Flashcard_Anki.csv' },
    { caption: `📚 Bạn có tổng cộng ${vocabs.length} từ vựng.\n👉 Nạp file này vào Anki hoặc Quizlet để ôn tập nhé!` }
  );
});

// Lệnh xóa sạch sổ tay
bot.command('clearvocab', async (ctx) => {
  clearVocabulary(ctx.from.id);
  await ctx.reply('🗑 Đã xóa sạch sổ tay từ vựng!');
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
  const isFast = !c.showTranslation && !c.showPronunciation && !c.showVocabulary;
  let statusMsg = null;
  try {
    statusMsg = await ctx.reply(`${statusMsgPrefix}...`);
    let aiResult = null;
    // Dialog context changes the answer; only reuse text cache for a fresh dialog.
    const eligibleForCache = Boolean(text && !imageUrl && c.history.length === 0);
    if (eligibleForCache) aiResult = getCachedText(text, c.targetLang, isFast);
    if (!aiResult) {
      aiResult = await translateFull(text, c.targetLang, isFast, imageUrl, c.history);
      if (eligibleForCache) setCachedText(text, c.targetLang, isFast, aiResult);
    }
    if (typeof aiResult !== 'string' || !aiResult.trim()) {
      throw new Error('AI returned an empty translation');
    }

    // Always keep the actual exchange in conversation history (including cached replies).
    c.history.push({ user: (text || 'Image/Audio').slice(0, 3000), bot: aiResult.slice(0, 4000) });
    if (c.history.length > 5) c.history.splice(0, c.history.length - 5);
    saveDatabase();

    const parsed = parseTelegramTranslation(aiResult);
    const translatedText = parsed.translation; // ONLY this text is copied or spoken.
    const sections = [];
    if (isFast || c.showTranslation) {
      sections.push({ title: isFast ? '⚡ Dịch nhanh:' : '📖 Bản dịch:', body: translatedText });
    }
    if (!isFast) {
      if (c.showTranslation && parsed.backTranslation) {
        sections.push({ title: '🔁 Bản dịch ngược:', body: parsed.backTranslation });
      }
      if (c.showPronunciation && parsed.pronunciation) {
        sections.push({ title: '🗣 Phiên âm:', body: parsed.pronunciation });
      }
      if (c.showVocabulary && parsed.vocabulary) {
        sections.push({ title: '📝 Từ vựng:', body: parsed.vocabulary });
      }
    }
    if (!sections.length) {
      // Avoid an empty response if all requested AI sections are missing.
      sections.push({ title: '📖 Bản dịch:', body: translatedText });
    }

    const nonce = crypto.randomBytes(6).toString('hex');
    c.pendingSpeech[nonce] = { text: translatedText, at: Date.now() };
    for (const old of Object.keys(c.pendingSpeech).slice(0, -30)) delete c.pendingSpeech[old];

    let vocabId = null;
    if (!isFast && c.showVocabulary && parsed.vocabulary) {
      vocabId = nonce;
      c.pendingVocabs[vocabId] = parsed.vocabulary;
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

    const messages = buildStudyMessages(sections);
    for (const [index, message] of messages.entries()) {
      const extra = {};
      // All icons appear in ONE row below the primary translation message.
      if (index === 0) extra.reply_markup = actions;
      await ctx.reply(message, extra);
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
