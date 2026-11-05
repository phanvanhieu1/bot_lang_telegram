const {
  getShuffledOpenAIClients
} = require('../providers/openai.provider');

const {
  buildProPrompt
} = require('../prompts/pro.prompt');
const {glossaryInstructions}=require('../terminology/resolver');
const {optimizedProRequest}=require('../prompts/v1-optimized');
const {v1ModelFor,V1_JSON_SCHEMA,parseV1Json}=require('../prompts/v1-output');
const {translationLanguageIssue}=require('../utils/translation-language');

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
  const optimized=process.env.V1_OPTIMIZED_PROMPTS==='true'&&!imageUrl;
  const jsonMode=optimized&&process.env.V1_OPTIMIZED_JSON_SCHEMA==='true';
  const request=optimized?optimizedProRequest(text,targetLangKey,isFastMode,{
    ...options,jsonMode
  }):null;
  const systemPrompt=optimized?request.system:buildProPrompt(
    text,targetLangKey,isFastMode,options
  )+glossaryInstructions(options.terms||[]);
  const userContent = [];
  if (text) userContent.push({ type: 'text', text: optimized?request.user:text });
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

  const model=optimized?v1ModelFor(text,{...options,history,imageUrl,
    backTranslation:!isFastMode&&options.backTranslation!==false,
    vocabulary:!isFastMode&&options.vocabulary!==false}):'gpt-4o';
  const clients = getShuffledOpenAIClients();
  if (!clients.length) throw new Error('Chưa cấu hình OPENAI_API_KEYS cho Telegram bot');

  let lastError = null;
  for (const openai of clients) {
    try {
      const startedAt=Date.now();
      const callBody={
        model,messages,temperature:0.3,
        ...(optimized?{max_completion_tokens:request.maxCompletionTokens}:{}),
        ...(jsonMode?{response_format:{type:'json_schema',
          json_schema:{name:'v1_translation',strict:true,schema:V1_JSON_SCHEMA}}}:{})
      };
      let response=await openai.chat.completions.create(callBody);
      let rawContent=response.choices?.[0]?.message?.content?.trim();
      if(!rawContent)throw new Error('OpenAI returned an empty translation');
      const parseContent=raw=>jsonMode?parseV1Json(raw,{
        supplement:Boolean(options.existingTranslation),
        backTranslation:!isFastMode&&options.backTranslation!==false,
        vocabulary:!isFastMode&&options.vocabulary!==false
      }):raw;
      let content=parseContent(rawContent);
      const extractedTranslation=raw=>{
        const lines=String(raw||'').split(String.fromCharCode(10));
        const index=lines.findIndex(line=>line.trim().toUpperCase().startsWith('TRANSLATION:'));
        if(index<0)return '';
        const first=lines[index].slice(lines[index].indexOf(':')+1).trim();
        const remaining=[];
        for(const line of lines.slice(index+1)){
          const upper=line.trim().toUpperCase();
          if(['BACK_TRANSLATION:','VOCABULARY:','VERIFICATION:'].some(x=>upper.startsWith(x)))break;
          remaining.push(line);
        }
        return [first,...remaining].join(String.fromCharCode(10)).trim();
      };
      let aggregateUsage={...response.usage};
      if(!options.existingTranslation&&translationLanguageIssue(text,extractedTranslation(content))){
        // One bounded retry; do not store or return output in the wrong language.
        const correction=[...messages,{role:'user',content:
          'The previous output was NOT Vietnamese (it was English or Chinese). Translate the ORIGINAL Chinese text into natural Vietnamese ONLY, using Vietnamese sentences and Vietnamese wording, not a Chinese paraphrase. Preserve codes, quantities, names and approved terminology. Keep the exact required output format.'}];
        const corrected=await openai.chat.completions.create({...callBody,
          messages:correction});
        const correctedRaw=corrected.choices?.[0]?.message?.content?.trim();
        if(!correctedRaw)throw new Error('V1_WRONG_TARGET_LANGUAGE');
        const correctedText=parseContent(correctedRaw);
        if(translationLanguageIssue(text,extractedTranslation(correctedText))){
          const err=new Error('V1_WRONG_TARGET_LANGUAGE');err.code='V1_WRONG_TARGET_LANGUAGE';
          throw err;
        }
        aggregateUsage={
          prompt_tokens:(response.usage?.prompt_tokens||0)+(corrected.usage?.prompt_tokens||0),
          completion_tokens:(response.usage?.completion_tokens||0)+(corrected.usage?.completion_tokens||0),
          total_tokens:(response.usage?.total_tokens||0)+(corrected.usage?.total_tokens||0),
          prompt_tokens_details:{cached_tokens:
            (response.usage?.prompt_tokens_details?.cached_tokens||0)+
            (corrected.usage?.prompt_tokens_details?.cached_tokens||0)}
        };
        response=corrected;
        rawContent=correctedRaw;
        content=correctedText;
      }
      // Exact provider-visible messages and raw output, captured only after
      // an explicitly requested V1 inspection. Never log or persist the trace.
      if(typeof options.inspectStage==='function'&&!imageUrl){
        options.inspectStage({
          role:options.existingTranslation?'supplement':'translator',
          provider:'openai',model:response.model||model,
          system:systemPrompt,
          input:JSON.stringify(messages.slice(1)),
          rawOutput:rawContent,ms:Date.now()-startedAt,
          usage:{input:aggregateUsage?.prompt_tokens||0,
            output:aggregateUsage?.completion_tokens||0,
            ...(optimized||aggregateUsage?.prompt_tokens_details?.cached_tokens
              ?{cacheRead:aggregateUsage?.prompt_tokens_details?.cached_tokens||0}:{})}
        });
      }
      return returnUsage ? { content, usage: {...aggregateUsage,
        model:response.model||model} } : content;
    } catch (error) {
      lastError = error;
      // Invalid input will fail for every key; do not burn retries.
      if ([400, 413, 422].includes(error?.status)||
          error?.code==='V1_WRONG_TARGET_LANGUAGE') throw error;
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