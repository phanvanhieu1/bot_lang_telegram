// errorHandler.js

async function handleError(error, ctx, statusMsgId = null) {
  // 1. Ghi log chi tiết ra Terminal để dev theo dõi
  const errData = error.response?.data || error.message || error;
  console.error('\n[LỖI HỆ THỐNG]:', JSON.stringify(errData, null, 2));

  // 2. Xóa tin nhắn trạng thái (ví dụ: "⏳ Đang phân tích...") nếu có
  if (statusMsgId) {
    try {
      await ctx.deleteMessage(statusMsgId);
    } catch (e) {
      // Bỏ qua nếu tin nhắn đã bị xóa từ trước
    }
  }

  // 3. Phân tích chuỗi lỗi để phản hồi đúng thông điệp
  const errorString = JSON.stringify(errData).toLowerCase();

  try {
    if (errorString.includes('429') || errorString.includes('resource_exhausted') || errorString.includes('quota exceeded')) {
      await ctx.reply(
        '⚠️ *Lỗi Hết Hạn Mức (429)*\n\n' +
        'Bạn đã dùng hết số lượt gọi Gemini API miễn phí. Vui lòng đợi vài phút rồi thử lại, hoặc kiểm tra lại thiết lập model.', 
        { parse_mode: 'Markdown' }
      );
    } 
    else if (errorString.includes('elevenlabs') || errorString.includes('insufficient') || errorString.includes('quota_exceeded')) {
      await ctx.reply(
        '⚠️ *Lỗi Giọng Đọc AI*\n\n' +
        'Tài khoản ElevenLabs của bạn đã hết số lượng ký tự miễn phí hoặc API Key không hợp lệ.', 
        { parse_mode: 'Markdown' }
      );
    } 
    else if (errorString.includes('message is not modified')) {
      // Lỗi do bấm trùng nút trên Telegram
      await ctx.answerCbQuery('Tùy chọn này đang được áp dụng rồi!');
    }
    else {
      await ctx.reply(
        '❌ *Lỗi Hệ Thống*\n\n' +
        'Đã xảy ra sự cố không mong muốn trong quá trình xử lý, vui lòng thử lại sau!', 
        { parse_mode: 'Markdown' }
      );
    }
  } catch (replyError) {
    console.error('[CRITICAL] Không thể gửi tin nhắn báo lỗi tới Telegram:', replyError.message);
  }
}

module.exports = handleError;