require('dotenv').config();
const { Telegraf } = require('telegraf');
const crypto = require('node:crypto');
const { withDownloadedVoice } = require('./telegram-media');
const { buildStudyMessages, copyButtonText, splitLongText } = require('./telegram-utils');

// Import Modules
const { Markup } = require('telegraf'); // Đảm bảo import Markup
const { getUserConfig, saveDatabase, isAuthorized, addAuthorizedUser, removeAuthorizedUser, getWhitelist, saveVocabulary, getVocabulary, clearVocabulary } = require('./session');
const { getCachedText, setCachedText, getCachedAudio, setCachedAudio, clearAudioCache } = require('./cache');
const { LANG_CONFIG, VOICES, SPEED_OPTIONS } = require('./config');
const MASTER_ADMIN = process.env.MASTER_ADMIN;
const { renderDashboard, renderMenu, renderDisplayMenu } = require('./ui');
const { translateFull, transcribeVoice, generateSpeech } = require('./ai');
const handleError = require('./errorHandler');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
// ==========================================
// CÀI ĐẶT MENU BUTTON TỰ ĐỘNG CHO TELEGRAM
// ==========================================
const BOT_COMMANDS = [
  { command: 'start', description: '🏠 Mở Bảng điều khiển Cài đặt' },
  { command: 'export', description: '💾 Xuất Sổ tay từ vựng ra file CSV' },
  { command: 'clearvocab', description: '🗑 Xóa sạch Sổ tay từ vựng' },
  { command: 'clearcache', description: '🧹 Dọn dẹp ổ cứng (Xóa bộ nhớ đệm audio)' },
  { command: 'listusers', description: '📋 Xem danh sách người dùng (Chỉ Admin)' },
  { command: 'settings', description: '⚙️ Cài đặt dịch thuật' }
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
  await ctx.reply(`👋 *Chào mừng bạn tới Bot AI (Modular Architecture)!*\nBạn có thể Gõ chữ, Gửi ảnh hoặc Ghi âm để bot dịch thuật.\n\n👉 Bấm /settings để mở cài đặt.`, { parse_mode: 'Markdown' });
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
bot.action('menu_speed', (ctx) => editMenu(ctx, renderMenu('⏩ *CHỌN TỐC ĐỘ*', SPEED_OPTIONS, getUserConfig(ctx.from.id).speed, 'set_speed')));
bot.action('menu_display', (ctx) => editMenu(ctx, renderDisplayMenu(getUserConfig(ctx.from.id))));
bot.action('menu_close', async (ctx) => { try { await ctx.deleteMessage(); } catch(e){} await ctx.answerCbQuery('Đã đóng'); });

// Thay đổi Ngôn ngữ / Giọng đọc / Tốc độ
bot.action(/set_(lang|voice|speed)_(.+)/, async (ctx) => {
  const [type, val] = [ctx.match[1], ctx.match[2]];
  const c = getUserConfig(ctx.from.id);
  const keyMap = { lang: 'targetLang', voice: 'voiceKey', speed: 'speed' };
  const actualVal = type === 'speed' ? parseFloat(val) : val;
  
  if (c[keyMap[type]] === actualVal) return ctx.answerCbQuery('Đang chọn mục này rồi!');
  
  c[keyMap[type]] = actualVal;
  saveDatabase(); // <--- THÊM DÒNG NÀY ĐỂ LƯU VĨNH VIỄN
  
  const renderFunc = type === 'lang' ? renderMenu('🌐 *CHỌN NGÔN NGỮ*', LANG_CONFIG, c.targetLang, 'set_lang') : 
                     type === 'voice' ? renderMenu('🎙 *CHỌN GIỌNG ĐỌC*', VOICES, c.voiceKey, 'set_voice') : 
                     renderMenu('⏩ *CHỌN TỐC ĐỘ*', SPEED_OPTIONS, c.speed, 'set_speed');
  await editMenu(ctx, renderFunc);
});

// Bật/Tắt Hiển thị và Âm thanh
bot.action(/toggle_(trans|pron|vocab|voice)/, async (ctx) => {
  const c = getUserConfig(ctx.from.id);
  const map = { trans: 'showTranslation', pron: 'showPronunciation', vocab: 'showVocabulary', voice: 'enableVoice' };
  
  c[map[ctx.match[1]]] = !c[map[ctx.match[1]]];
  saveDatabase();
  
  await editMenu(ctx, renderDisplayMenu(c));
});

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
    await ctx.editMessageReplyMarkup({ inline_keyboard: [
      [Markup.button.callback('✅ Đã lưu vào sổ tay', 'noop')]
    ] });
  } catch (error) {
    if (!/message is not modified/i.test(error?.message || '')) {
      console.warn('Telegram update save button:', error.message);
    }
  }
});

// Old buttons cannot be linked reliably to a particular translation.
bot.action('save_vocab', ctx => ctx.answerCbQuery('Hãy dịch lại câu này để lưu đúng từ vựng.'));
bot.action('noop', ctx => ctx.answerCbQuery());

// Lệnh xuất sổ tay từ vựng ra file CSV
bot.command('export', async (ctx) => {
  const vocabs = getVocabulary(ctx.from.id);
  if (vocabs.length === 0) return ctx.reply('📭 Sổ tay của bạn đang trống!');

  const csvContent = vocabs.join('\n');
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

    const sections = [];
    let translatedText = aiResult.trim();
    const buttons = [];
    if (isFast) {
      sections.push({ title: '⚡ Dịch nhanh:', body: translatedText });
    } else {
      const trans = (aiResult.match(/TRANSLATION:\s*([\s\S]*?)(?=PRONUNCIATION:|VOCABULARY:|$)/i) || [])[1]?.trim();
      const pron = (aiResult.match(/PRONUNCIATION:\s*([\s\S]*?)(?=VOCABULARY:|$)/i) || [])[1]?.trim();
      const vocab = (aiResult.match(/VOCABULARY:\s*([\s\S]*)/i) || [])[1]?.trim();
      translatedText = trans || aiResult.split('\n')[0].trim();
      if (c.showTranslation) sections.push({ title: '📖 Bản dịch:', body: translatedText });
      if (c.showPronunciation && pron) sections.push({ title: '🗣 Phiên âm:', body: pron });
      if (c.showVocabulary && vocab) {
        sections.push({ title: '📝 Từ vựng:', body: vocab });
        const nonce = crypto.randomBytes(6).toString('hex');
        c.pendingVocabs[nonce] = vocab;
        // Bound persisted pending data.
        const keys = Object.keys(c.pendingVocabs);
        for (const old of keys.slice(0, -20)) delete c.pendingVocabs[old];
        saveDatabase();
        buttons.push([Markup.button.callback('💾 Lưu cụm từ vựng này', 'save_vocab_' + nonce)]);
      }
    }
    if (!sections.length) sections.push({ title: '📖 Kết quả:', body: translatedText });
    const copy = copyButtonText(translatedText);
    if (copy) buttons.unshift([Markup.button.copyText('📋 Copy bản dịch', copy)]);

    const messages = buildStudyMessages(sections);
    for (const [index, message] of messages.entries()) {
      const extra = {};
      // Buttons are attached once to the result, not repeated on every chunk.
      if (index === 0 && buttons.length) extra.reply_markup = { inline_keyboard: buttons };
      await ctx.reply(message, extra);
    }

    if (c.enableVoice && translatedText) {
      try {
        let audio = getCachedAudio(translatedText, c.voiceKey, c.speed);
        if (!audio) {
          audio = await generateSpeech(translatedText, c.voiceKey, c.speed);
          setCachedAudio(translatedText, c.voiceKey, c.speed, audio);
        }
        // ElevenLabs returns MP3. Telegram sendVoice supports MP3 uploads.
        await ctx.replyWithVoice({ source: audio, filename: 'translation.mp3' });
      } catch (error) {
        console.error('Telegram TTS:', error?.status || error?.code || error?.message);
        await ctx.reply('⚠️ Bản dịch đã gửi thành công, nhưng chưa thể tạo giọng đọc.');
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

bot.launch().then(async () => {
  console.log('🚀 Telegram bot đã khởi chạy');
  try { await bot.telegram.setMyCommands(BOT_COMMANDS); } catch (error) {
    console.warn('Không thể cập nhật menu Telegram:', error.message);
  }
}).catch(error => {
  console.error('Không thể khởi chạy Telegram bot:', error.message);
  process.exitCode = 1;
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
