'use strict';

// Provider adapters for opt-in V2. Existing V1 providers and credentials unchanged.
const DEFAULTS = Object.freeze({
  openai: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
  groq: 'qwen/qwen3.8-27b',
  openrouter: 'google/gemma-4-31b-it:free'
});

function safeError(code, status) {
  const error = new Error(code);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function outputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const parts = (data?.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text);
  return parts.join('\n').trim();
}

async function postJson(url, headers, body, timeoutMs = 60000) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST', headers: {'content-type':'application/json',...headers},
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (_) {
    throw safeError('V2_PROVIDER_NETWORK_ERROR');
  }
  if (!response.ok) {
    // Never log raw provider bodies, key headers or supplied text.
    throw safeError('V2_PROVIDER_HTTP_ERROR', response.status);
  }
  try { return await response.json(); }
  catch (_) { throw safeError('V2_PROVIDER_INVALID_JSON'); }
}

function createProviders(env = process.env) {
  const openaiModel = env.V2_OPENAI_MODEL || DEFAULTS.openai;
  const claudeModel = env.V2_CLAUDE_MODEL || DEFAULTS.claude;
  const groqModel = env.V2_GROQ_MODEL || DEFAULTS.groq;
  const routerModel = env.V2_OPENROUTER_MODEL || DEFAULTS.openrouter;
  const allowFree = env.V2_ALLOW_FREE_PROVIDERS !== 'false';
  const openaiKey = (env.OPENAI_API_KEYS || '').split(',').map(x=>x.trim()).find(Boolean) ||
    env.OPENAI_API_KEY || env.OPENAI_API;
  const claudeKey = env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || env.CLAUDE_API;
  const groqKey = env.GROQ_API_KEY || env.GROQ_API;
  const routerKey = env.OPENROUTER_API_KEY || env.OPENROUTER_API;

  async function openai(system, user, meta={}) {
    if (!openaiKey) throw safeError('V2_MISSING_OPENAI_KEY');
    const body = {
      model: openaiModel, instructions: system,
      input: [{role:'user',content:[{type:'input_text',text:user}]}],
      max_output_tokens: meta.maxOutputTokens || 2400
    };
    // GPT-4o/4.1 do not accept a reasoning.effort override.
    if (/^(gpt-[56]|o[1-9])/.test(openaiModel)) {
      body.reasoning = { effort: 'medium' };
    }
    const data = await postJson('https://api.openai.com/v1/responses', {
      authorization: 'Bearer ' + openaiKey
    }, body, 90000);
    const text = outputText(data);
    if (!text) throw safeError('V2_OPENAI_EMPTY');
    return {
      text, provider:'openai', model:data.model || openaiModel,
      usage:{ input:Number(data.usage?.input_tokens||0),
        output:Number(data.usage?.output_tokens||0) }
    };
  }

  async function claude(system, user, meta={}) {
    if (!claudeKey) throw safeError('V2_MISSING_CLAUDE_KEY');
    const data = await postJson('https://api.anthropic.com/v1/messages', {
      'x-api-key': claudeKey,
      'anthropic-version': '2023-06-01'
    }, {
      model: claudeModel, max_tokens: meta.maxOutputTokens || 1800,
      system, messages: [{role:'user',content:user}]
    }, 90000);
    const text = (data.content || []).filter(x=>x.type==='text').map(x=>x.text||'').join('\n').trim();
    if (!text) throw safeError('V2_CLAUDE_EMPTY');
    return {
      text, provider:'claude',model:data.model || claudeModel,
      usage:{input:Number(data.usage?.input_tokens||0),
        output:Number(data.usage?.output_tokens||0)}
    };
  }

  async function freeRequest(type, system, user, model, key, baseURL) {
    if (!allowFree) throw safeError('V2_FREE_PROVIDERS_DISABLED');
    if (!key) throw safeError('V2_MISSING_' + type.toUpperCase() + '_KEY');
    const data = await postJson(baseURL + '/chat/completions', {
      authorization: 'Bearer ' + key
    },{
      model, messages:[{role:'system',content:system},{role:'user',content:user}],
      temperature:0, max_tokens:1100
    },45000);
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw safeError('V2_' + type.toUpperCase() + '_EMPTY');
    return { text,provider:type,model:data.model || model,
      usage:{input:Number(data.usage?.prompt_tokens||0),
        output:Number(data.usage?.completion_tokens||0)} };
  }

  async function deepl(text,target) {
    if (!allowFree) throw safeError('V2_FREE_PROVIDERS_DISABLED');
    // Reuse existing DeepL Free implementation, and only for supported ZH/VI.
    const key = env.DEEPL_API_KEY || env.DEEPL_API;
    if (!key) throw safeError('V2_MISSING_DEEPL_KEY');
    const data=await postJson('https://api-free.deepl.com/v2/translate',{
      authorization:'DeepL-Auth-Key '+key
    },{text:[text],target_lang:target},25000);
    const translated = data.translations?.[0]?.text?.trim();
    if (!translated) throw safeError('V2_DEEPL_EMPTY');
    return {text:translated, provider:'deepl',model:'deepl-free',
      usage:{input:0,output:0,characters:text.length}};
  }

  return {
    openai, claude,
    groq:(system,user)=>freeRequest('groq',system,user,groqModel,groqKey,'https://api.groq.com/openai/v1'),
    openrouter:(system,user)=>freeRequest('openrouter',system,user,routerModel,routerKey,'https://openrouter.ai/api/v1'),
    deepl
  };
}
module.exports = { createProviders, safeError, outputText, DEFAULTS };
