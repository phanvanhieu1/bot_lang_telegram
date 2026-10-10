const {
  getRandomOpenAIClient,
  getOpenAIKeyCount
} = require('../providers/openai.provider');

const {
  buildProPrompt
} = require('../prompts/pro.prompt');

// 3. CORE 1: Dịch thuật & Phân tích ảnh có FAILOVER (Chống sập)
// Thêm tham số `history` vào hàm
async function translateFull(
  text,
  targetLangKey,
  isFastMode,
  imageUrl = null,
  history = [],
  returnUsage = false,
  options = {}
) {
  const systemPrompt = buildProPrompt(
  text,
  targetLangKey,
  isFastMode,
  options
);
  const userContent = [];
  if (text) userContent.push({ type: 'text', text: text });
  if (imageUrl) {
    userContent.push({ type: 'text', text: 'Dịch văn bản trong ảnh.' });
    userContent.push({ type: 'image_url', image_url: { url: imageUrl } });
  }

  // BƠM NGỮ CẢNH VÀO MẢNG MESSAGES
  const messages = [{ role: 'system', content: systemPrompt }];

  // Đưa 5 tin nhắn lịch sử vào để bot nhớ
  history.forEach(h => {
    messages.push({ role: 'user', content: h.user });
    messages.push({ role: 'assistant', content: h.bot });
  });

  messages.push({ role: 'user', content: userContent });

  let attempts = 0;
  const maxAttempts = getOpenAIKeyCount();

  while (attempts < maxAttempts) {
    try {
      const openai = getRandomOpenAIClient();
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: messages, // Đã bao gồm cả system, history và tin nhắn mới
        temperature: 0.3,
      });
      const content = response.choices[0].message.content.trim();

if (returnUsage) {
  return {
    content,
    usage: response.usage
  };
}

return content;
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) throw new Error('❌ Hết Key.');
    }
  }
}

module.exports = {
  translateFull
};