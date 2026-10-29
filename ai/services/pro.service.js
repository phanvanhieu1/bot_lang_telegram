const {
  getShuffledOpenAIClients
} = require('../providers/openai.provider');

const {
  buildProPrompt
} = require('../prompts/pro.prompt');
const {glossaryInstructions}=require('../terminology/resolver');

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
) + glossaryInstructions(options.terms||[]);
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

  const clients = getShuffledOpenAIClients();
  if (!clients.length) throw new Error('Chưa cấu hình OPENAI_API_KEYS cho Telegram bot');

  let lastError = null;
  for (const openai of clients) {
    try {
      const startedAt=Date.now();
      const response = await openai.chat.completions.create({
        model: 'gpt-4o', messages, temperature: 0.3
      });
      const content = response.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('OpenAI returned an empty translation');
      // Exact provider-visible messages and raw output, captured only after
      // an explicitly requested V1 inspection. Never log or persist the trace.
      if(typeof options.inspectStage==='function'&&!imageUrl){
        options.inspectStage({
          role:options.existingTranslation?'supplement':'translator',
          provider:'openai',model:response.model||'gpt-4o',
          system:systemPrompt,
          input:JSON.stringify(messages.slice(1)),
          rawOutput:content,ms:Date.now()-startedAt,
          usage:{input:response.usage?.prompt_tokens||0,
            output:response.usage?.completion_tokens||0}
        });
      }
      return returnUsage ? { content, usage: response.usage } : content;
    } catch (error) {
      lastError = error;
      // Invalid input will fail for every key; do not burn retries.
      if ([400, 413, 422].includes(error?.status)) throw error;
      console.error('[Telegram translation] OpenAI attempt failed:', error?.status || error?.code || 'UNKNOWN');
    }
  }
  const finalError = new Error('Tất cả API key OpenAI đã thử đều không khả dụng', { cause: lastError });
  finalError.status = lastError?.status;
  throw finalError;
}

module.exports = {
  translateFull
};