require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Import Modules
const { Markup } = require('telegraf'); // Đảm bảo import Markup
const { getUserConfig, saveDatabase, isAuthorized, addAuthorizedUser, removeAuthorizedUser, getWhitelist, saveVocabulary, getVocabulary, clearVocabulary } = require('./session');
const { getCachedText, setCachedText, getCachedAudio, setCachedAudio } = require('./cache');
const { LANG_CONFIG, VOICES, SPEED_OPTIONS } = require('./config');
const MASTER_ADMIN = process.env.MASTER_ADMIN;
const { renderDashboard, renderMenu, renderDisplayMenu } = require('./ui');
const { translateFull, transcribeVoice, generateSpeech } = require('./ai');
const handleError = require('./errorHandler');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
// ==========================================
// CÀI ĐẶT MENU BUTTON TỰ ĐỘNG CHO TELEGRAM
// ==========================================
bot.telegram.setMyCommands([
  { command: 'start', description: '🏠 Mở Bảng điều khiển Cài đặt' },
  { command: 'export', description: '💾 Xuất Sổ tay từ vựng ra file CSV' },
  { command: 'clearvocab', description: '🗑 Xóa sạch Sổ tay từ vựng' },
  { command: 'clearcache', description: '🧹 Dọn dẹp ổ cứng (Xóa bộ nhớ đệm audio)' },
  { command: 'listusers', description: '📋 Xem danh sách người dùng (Chỉ Admin)' }
]);
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
  if (args.length < 2) return ctx.reply('⚠️ *Cú pháp:* `/adduser <Telegram_ID>`', { parse_mode: 'Markdown' });
  
  const newId = args[1];
  addAuthorizedUser(newId);
  ctx.reply(`✅ Đã cấp quyền sử dụng Bot cho ID: \`${newId}\``, { parse_mode: 'Markdown' });
});

bot.command('removeuser', async (ctx) => {
  if (ctx.from.id.toString() !== MASTER_ADMIN) return;
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('⚠️ *Cú pháp:* `/removeuser <Telegram_ID>`', { parse_mode: 'Markdown' });
  
  const targetId = args[1];
  if (targetId === MASTER_ADMIN) return ctx.reply('❌ Bạn không thể tự xóa quyền của chính mình!');
  
  removeAuthorizedUser(targetId);
  ctx.reply(`🗑 Đã thu hồi quyền sử dụng Bot của ID: \`${targetId}\``, { parse_mode: 'Markdown' });
});

bot.command('listusers', async (ctx) => {
  if (ctx.from.id.toString() !== MASTER_ADMIN) return;
  const wl = getWhitelist();
  ctx.reply(`📋 *DANH SÁCH ĐƯỢC CẤP QUYỀN:*\n\n${wl.map((id, i) => `${i+1}. \`${id}\``).join('\n')}`, { parse_mode: 'Markdown' });
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
  try { await ctx.editMessageText(renderData.text, { parse_mode: 'Markdown', ...renderData.keyboard }); } catch (e) {}
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

// Bắt sự kiện bấm nút "Lưu từ vựng"
bot.action('save_vocab', async (ctx) => {
  const c = getUserConfig(ctx.from.id);
  if (!c.lastVocab) return ctx.answerCbQuery('Không tìm thấy từ vựng để lưu!');
  
  const savedCount = saveVocabulary(ctx.from.id, c.lastVocab);
  c.lastVocab = ""; // Xóa tạm sau khi lưu
  saveDatabase();

  await ctx.answerCbQuery(`✅ Đã lưu ${savedCount} từ vào Sổ tay!`);
  // Đổi text của nút để báo thành công
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[Markup.button.callback('✅ Đã lưu vào sổ tay', 'noop')]] }); } catch(e){}
});

bot.action('noop', (ctx) => ctx.answerCbQuery());

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
bot.command('clearvocab', (ctx) => {
  clearVocabulary(ctx.from.id);
  ctx.reply('🗑 Đã xóa sạch sổ tay từ vựng!');
});

// --- CORE PROCESSOR: XỬ LÝ CHUNG CHO VĂN BẢN, ẢNH, GIỌNG NÓI ---
async function processStudyContent(ctx, text = '', imageUrl = null, statusMsgPrefix = '⏳ Đang phân tích') {
  const c = getUserConfig(ctx.from.id);
  const isFast = !c.showTranslation && !c.showPronunciation && !c.showVocabulary;
  const statusMsg = await ctx.reply(`${statusMsgPrefix}...`);

  try {
    let aiResult;
    // 1. KIỂM TRA CACHE (CHỈ ÁP DỤNG CHO TEXT THUẦN, KHÔNG DÙNG CHO ẢNH/VOICE)
    if (text && !imageUrl) {
      aiResult = getCachedText(text, c.targetLang, isFast);
    }
    
    // 2. NẾU KHÔNG CÓ TRONG CACHE -> GỌI GPT
    if (!aiResult) {
      aiResult = await translateFull(text, c.targetLang, isFast, imageUrl, c.history);
      if (text && !imageUrl) setCachedText(text, c.targetLang, isFast, aiResult); // Lưu Cache
      
      // LƯU VÀO LỊCH SỬ NGỮ CẢNH (Tối đa 5 lượt)
      c.history.push({ user: text || 'Image/Audio', bot: aiResult });
      if (c.history.length > 5) c.history.shift();
      saveDatabase();
    }

    let cleanText = aiResult;
    let parts = [];
    let inlineKeyboard = [];

    if (!isFast) {
      const trans = (aiResult.match(/TRANSLATION:\s*([\s\S]*?)(?=PRONUNCIATION:|VOCABULARY:|$)/i) || [])[1]?.trim();
      const pron = (aiResult.match(/PRONUNCIATION:\s*([\s\S]*?)(?=VOCABULARY:|$)/i) || [])[1]?.trim();
      const vocab = (aiResult.match(/VOCABULARY:\s*([\s\S]*)/i) || [])[1]?.trim();
      
      cleanText = trans || aiResult.split('\n')[0].trim();
      if (c.showTranslation && trans) parts.push(`📖 *Bản dịch:*\n${trans}`);
      if (c.showPronunciation && pron) parts.push(`🗣 *Phiên âm:*\n${pron}`);
      
      // XỬ LÝ TỪ VỰNG VÀ NÚT LƯU FLASHCARD
      if (c.showVocabulary && vocab) {
        parts.push(`📝 *Từ vựng:*\n${vocab}`);
        c.lastVocab = vocab; // Lưu tạm vào RAM để chờ bấm nút
        saveDatabase();
        inlineKeyboard.push([Markup.button.callback('💾 Lưu cụm từ vựng này', 'save_vocab')]);
      }
    } else {
      parts.push(`⚡ *Dịch nhanh:*\n${cleanText}`);
    }

    // 3. XỬ LÝ ÂM THANH (CÓ CACHE ELEVENLABS)
    let audio = null;
    if (c.enableVoice) {
      audio = getCachedAudio(cleanText, c.voiceKey, c.speed); // Check Cache
      if (!audio) {
        audio = await generateSpeech(cleanText, c.voiceKey, c.speed); // Gọi API
        setCachedAudio(cleanText, c.voiceKey, c.speed, audio); // Lưu ổ cứng
      }
    }

    try { await ctx.deleteMessage(statusMsg.message_id); } catch(e){}
    
    // 4. TRẢ KẾT QUẢ KÈM NÚT BẤM
    if (parts.length > 0) {
      const extra = { parse_mode: 'Markdown' };
      if (inlineKeyboard.length > 0) extra.reply_markup = { inline_keyboard: inlineKeyboard };
      await ctx.reply(parts.join('\n\n'), extra);
    }
    
    if (audio) await ctx.replyWithVoice({ source: audio });

  } catch (error) {
    await handleError(error, ctx, statusMsg.message_id);
  }
}

// --- MESSAGE HANDLERS: NHẬN SỰ KIỆN ĐẦU VÀO ---
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  await processStudyContent(ctx, ctx.message.text.trim(), null, '⏳ Đang phân tích văn bản');
});

bot.on('photo', async (ctx) => {
  const photo = ctx.message.photo.pop();
  const fileLink = await ctx.telegram.getFileLink(photo.file_id);
  const caption = ctx.message.caption ? ctx.message.caption.trim() : '';
  await processStudyContent(ctx, caption, fileLink.href, '🖼 Đang phân tích hình ảnh');
});

bot.on('voice', async (ctx) => {
  const statusMsg = await ctx.reply('🎙 Đang nghe và nhận diện giọng nói...');
  try {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const filePath = path.join(os.tmpdir(), `${ctx.message.voice.file_id}.ogg`);
    
    // Tải file audio về thư mục tạm
    const response = await axios({ url: fileLink.href, responseType: 'stream' });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Gọi Whisper siêu gọn (đã tích hợp tự đổi key bên ai.js)
    const spokenText = await transcribeVoice(filePath);
    
    fs.unlinkSync(filePath); // Xóa file tạm
    try { await ctx.deleteMessage(statusMsg.message_id); } catch(e){}
    
    if (spokenText) {
      await ctx.reply(`_"${spokenText}"_`, { parse_mode: 'Markdown' });
      await processStudyContent(ctx, spokenText, null, '⏳ Đang phân tích câu nói');
    }
  } catch (error) {
    await handleError(error, ctx, statusMsg.message_id);
  }
});

bot.launch();
console.log('🚀 Bot đã khởi chạy。。。');
process.once('SIGINT', () => bot.stop());