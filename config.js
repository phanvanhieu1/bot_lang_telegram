// Match the 4 Mandarin PRO voices configured in public/index.html and web-tts.js.
// Use stable voice keys in Telegram settings, not provider-specific IDs as callback data.
const VOICES = {
  female1: { id: 'ByhETIclHirOlWnWKhHc', name: '👩 Giọng nữ 1' },
  male1:   { id: 'D9bZgM9Er0PhIxuW9Jqa', name: '👨 Giọng nam 1' },
  male2:   { id: '2I36mEahS1u7ZnTKUoaB', name: '👨 Giọng nam 2' },
  female2: { id: 'BqljjWyTnrioXPCNkCd4', name: '👩 Giọng nữ 2' }
};

const LANG_CONFIG = {
  'zh': { name: '🇨🇳 Tiếng Trung', promptName: 'tiếng Trung Giản thể', pinyinName: 'Pinyin' },
  'en': { name: '🇺🇸 Tiếng Anh', promptName: 'tiếng Anh chuẩn', pinyinName: 'IPA' },
  'ja': { name: '🇯🇵 Tiếng Nhật', promptName: 'tiếng Nhật', pinyinName: 'Romaji & Hiragana' },
  'ko': { name: '🇰🇷 Tiếng Hàn', promptName: 'tiếng Hàn', pinyinName: 'Romanization' },
};

const SPEED_OPTIONS = { 
  '0.8': '🐢 Chậm (0.8x)', 
  '1.0': '🚶 Vừa (1.0x)', 
  '1.15': '⚡ Nhanh (1.15x)' 
};

module.exports = { VOICES, LANG_CONFIG, SPEED_OPTIONS };