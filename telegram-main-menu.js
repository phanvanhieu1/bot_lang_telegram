'use strict';

// These are reply keyboard buttons below Telegram's input field.
// Use raw Bot API markup: Telegraf 4.16.3 does not expose all new button styles.
const MAIN_MENU = Object.freeze({
  translate: '📖 Dịch thuật',
  vocabulary: '📚 Từ vựng',
  voice: '🔊 Giọng đọc',
  practice: '📝 Luyện tập',
  settings: '⚙️ Cài đặt',
  statistics: '📊 Thống kê'
});

function replyMenuMarkup() {
  return {
    keyboard: [
      [
        { text: MAIN_MENU.translate, style: 'success' },
        { text: MAIN_MENU.vocabulary, style: 'primary' }
      ],
      [
        { text: MAIN_MENU.voice },
        { text: MAIN_MENU.practice },
        { text: MAIN_MENU.settings }
      ],
      [
        { text: MAIN_MENU.statistics, style: 'primary' }
      ]
    ],
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false,
    input_field_placeholder: 'Nhập câu cần dịch hoặc chọn menu...'
  };
}

function replyMenuOptions() {
  return { reply_markup: replyMenuMarkup() };
}

module.exports = { MAIN_MENU, replyMenuMarkup, replyMenuOptions };
