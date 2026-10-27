'use strict';

function classifyError(error) {
  const status = Number(error?.status || error?.response?.status || error?.cause?.status) || null;
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const url = String(error?.config?.url || error?.cause?.config?.url || '');
  if (status === 429) {
    return '⚠️ API đang bị giới hạn lượt gọi (429) hoặc đã hết quota. Vui lòng thử lại sau.';
  }
  if (/api\.elevenlabs\.io/i.test(url)) {
    return '⚠️ Dịch thuật vẫn hoạt động, nhưng dịch vụ giọng đọc ElevenLabs đang gặp lỗi.';
  }
  if (status === 401 || status === 403) {
    return '⚠️ API chưa được cấp quyền hoặc khóa API không hợp lệ. Vui lòng liên hệ quản trị viên.';
  }
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return '⚠️ Kết nối API quá thời gian chờ. Vui lòng thử lại.';
  }
  return '❌ Có lỗi khi xử lý yêu cầu. Vui lòng thử lại sau.';
}

async function handleError(error, ctx, statusMsgId = null) {
  // Never dump upstream response bodies, prompts, or credential-bearing URLs.
  console.error('[TELEGRAM ERROR]', {
    message: error?.message || 'Unknown error',
    code: error?.code || error?.cause?.code || null,
    status: error?.status || error?.response?.status || error?.cause?.status || null
  });
  if (statusMsgId) {
    try { await ctx.deleteMessage(statusMsgId); } catch {}
  }
  try { await ctx.reply(classifyError(error)); }
  catch (replyError) {
    console.error('[TELEGRAM] Cannot send error response:', replyError.message);
  }
}

module.exports = handleError;
module.exports.classifyError = classifyError;
