const { Markup } = require('telegraf');
const { LANG_CONFIG, VOICES, SPEED_OPTIONS } = require('./config');

const getSpeedKey = speed => Object.keys(SPEED_OPTIONS).find(key => Number(key) === Number(speed)) || '1.0';

const getDisplaySummary = c =>
  `Bản dịch | Pinyin: ${c.showPronunciation ? 'BẬT' : 'TẮT'} | Dịch ngược: ${c.showBackTranslation !== false ? 'BẬT' : 'TẮT'} | Từ vựng: ${c.showVocabulary ? 'BẬT' : 'TẮT'}`;

const renderDashboard = (c) => ({
  text: `⚙️ *BẢNG ĐIỀU KHIỂN CÀI ĐẶT*\n\n🌐 *Ngôn ngữ:* ${LANG_CONFIG[c.targetLang].name}\n🎙 *Giọng tiếng Trung:* ${VOICES[c.voiceKey].name}\n⏩ *Tốc độ:* ${SPEED_OPTIONS[getSpeedKey(c.speed)]}\n📋 *Kết quả:* ${getDisplaySummary(c)}\n🇻🇳 *Giọng tiếng Việt:* Cố định`,
  keyboard: Markup.inlineKeyboard([
    [Markup.button.callback('🌐 Đổi Ngôn ngữ', 'menu_lang'), Markup.button.callback('🎙 Đổi Giọng đọc', 'menu_voice')],
    [Markup.button.callback('⏩ Đổi Tốc độ', 'menu_speed'), Markup.button.callback('📋 Tùy chỉnh hiển thị', 'menu_display')],
    [Markup.button.callback('❌ Đóng Cài đặt', 'menu_close')],
  ])
});

const renderMenu = (title, configObj, currentVal, prefix) => ({
  text: `${title}`,
  keyboard: Markup.inlineKeyboard([
    ...Object.entries(configObj).reduce((acc, [k, v], i) => {
      const btn = Markup.button.callback(`${k === currentVal ? '✅ ' : ''}${v.name || v}`, `${prefix}_${k}`);
      i % 2 === 0 ? acc.push([btn]) : acc[acc.length - 1].push(btn);
      return acc;
    }, []),
    [Markup.button.callback('🔙 Quay lại', 'menu_main')]
  ])
});

const renderDisplayMenu = (c) => ({
  text: '📋 *TÙY CHỈNH HIỂN THỊ*\n\nBản dịch chính luôn hiển thị. Pinyin, dịch ngược và từ vựng có thể bật/tắt riêng; tất cả trong một tin nhắn.\n\nTừ vựng được phân tích khi BẬT và có thể lưu bằng 💾.',
  keyboard: Markup.inlineKeyboard([
    [Markup.button.callback(c.showPronunciation ? '🟢 Pinyin: BẬT' : '🔴 Pinyin: TẮT', 'toggle_pron')],
    [Markup.button.callback(c.showBackTranslation !== false ? '🟢 Dịch ngược: BẬT' : '🔴 Dịch ngược: TẮT', 'toggle_back')],
    [Markup.button.callback(c.showVocabulary ? '🟢 Từ vựng: BẬT' : '🔴 Từ vựng: TẮT', 'toggle_vocab')],
    [Markup.button.callback('🔙 Quay lại', 'menu_main')]
  ])
});

module.exports = { renderDashboard, renderMenu, renderDisplayMenu, getSpeedKey };