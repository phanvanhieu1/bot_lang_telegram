const VOICES = {
  'sarah': { id: 'JZLpE3AGwpKYZI2X65hN', name: 'Mingyao ye' },
  'rachel': { id: '21m00Tcm4TlvDq8ikWAM', name: '👩 Rachel (Nữ - Truyền cảm)' },
  'adam': { id: 'hZTuv9Zqrq4yHYrEmF1r', name: 'Adam li' },
  'george': { id: 'JBFqnCBsd6RMkjVDRZzb', name: '👨 George (Nam - Dứt khoát)' },
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