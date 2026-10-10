
const { pinyin } = require('pinyin-pro');

function generatePinyin(text) {
  if (!text || !text.trim()) {
    return '';
  }

  return pinyin(text, {
    toneType: 'symbol',
    type: 'string'
  });
}

module.exports = {
  generatePinyin
};
