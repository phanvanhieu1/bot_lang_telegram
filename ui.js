const { Markup } = require('telegraf');
const { LANG_CONFIG, VOICES, SPEED_OPTIONS } = require('./config');

const getDisplaySummary = (c) => {
  const parts = [
    c.showTranslation ? 'Bản' : '', 
    c.showPronunciation ? 'Âm' : '', 
    c.showVocabulary ? 'Từ' : ''
  ].filter(Boolean);
  
  const textSummary = parts.length > 0 ? parts.join('-') : '⚡ Siêu Tốc';
  const voiceSummary = c.enableVoice ? '🔊 Đọc' : '🔇 Câm';
  
  return `${textSummary} | ${voiceSummary}`;
};

const renderDashboard = (c) => ({
  text: `⚙️ *BẢNG ĐIỀU KHIỂN CÀI ĐẶT*\n\n🌐 *Ngôn ngữ:* ${LANG_CONFIG[c.targetLang].name}\n🎙 *Giọng đọc:* ${VOICES[c.voiceKey].name}\n⏩ *Tốc độ:* ${SPEED_OPTIONS[c.speed] || c.speed+'x'}\n📋 *Hiển thị:* ${getDisplaySummary(c)}`,
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
  text: `📋 *TÙY CHỈNH NỘI DUNG & ÂM THANH*`,
  keyboard: Markup.inlineKeyboard([
    [Markup.button.callback(c.showTranslation ? '🟢 Bản dịch: BẬT' : '🔴 Bản dịch: TẮT', 'toggle_trans')],
    [Markup.button.callback(c.showPronunciation ? '🟢 Phiên âm: BẬT' : '🔴 Phiên âm: TẮT', 'toggle_pron')],
    [Markup.button.callback(c.showVocabulary ? '🟢 Từ vựng: BẬT' : '🔴 Từ vựng: TẮT', 'toggle_vocab')],
    [Markup.button.callback(c.enableVoice ? '🔊 Giọng đọc AI: BẬT' : '🔇 Giọng đọc AI: TẮT', 'toggle_voice')],
    [Markup.button.callback('🔙 Quay lại', 'menu_main')]
  ])
});

module.exports = { renderDashboard, renderMenu, renderDisplayMenu };