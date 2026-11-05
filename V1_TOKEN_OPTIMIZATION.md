# V1 optimization rollout (Web Pro + Telegram + FREE)

Branch: feature/translation-engine-v2. This is NOT a production rollout.

## Already present before this change
- V1 result caching, V1 glossary scanning and authoritative approved mappings.
- V1 UI inspection, token/timing display and user-selected conversation context.
- V1 Pro system/user role separation for ordinary translation.
- V1 FREE provider fallbacks (Groq, OpenRouter, DeepL). DeepL is not a prompt-capable LLM.

## Added
- Stable, shorter English system prompts for V1 Pro and V1 FREE LLMs.
- Per-request source, context and glossary stored in a user JSON payload, never
  concatenated into the stable system prefix. This also covers Pro supplement requests.
- Dynamic output ceilings for V1 Pro and FREE LLM responses.
- Optional strict OpenAI JSON Schema with a compatibility adapter returning legacy
  TRANSLATION / BACK_TRANSLATION / VOCABULARY text, so existing UI parsers work.
- Extremely conservative, optional gpt-4o-mini routing for a fixed small list
  of Chinese greeting phrases without work context, user terms, history,
  extra output requirements or ambiguity-prone source. Everything else uses gpt-4o.
- Actual provider model and cached input tokens in V1 cost estimation.
- Explicit tests for optimized prefix stability, schema adapter, token estimates
  and routing safeguards.

## Correct output language and one-call policy (2026-11-05)
- Fixed a V1 Pro optimized-prompt regression: `targetLanguage` had contained the
  selected learning language ("tiếng Trung Giản thể") even when the source
  was Chinese. It now contains the **actual translation target**: Chinese
  source -> `vi`; Vietnamese source -> `zh`.
- `learningLanguage` remains a separate field and never controls the
  translation target. V1 FREE optimized payloads use the same direction fields.
- Both V1 Pro and V2 prompts now explicitly prioritize the target translation
  language over the language of the prompt, metadata, or Claude analysis.
- Wrong-language outputs fail closed and are not cached. The extra GPT call
  added solely for language correction has been removed from V1 Pro and V2.
- V2 retains its existing optional targeted repair for **other** independently
  verified issues (for example, a missing approved glossary term).
- Provider failover in V1 FREE is a separate, pre-existing behavior. No new
  language-repair model call was introduced for FREE.
- The optimized prompt remains opt-in; enable in staging, compare real
  translations and confirm all tests before production deployment.

## Feature flags (ALL off by default)
- V1_OPTIMIZED_PROMPTS=true
  Enables system/user JSON separation and English prompt on Pro, Groq and OpenRouter.
  DeepL unchanged. Image translations remain on the original prompt.
- V1_OPTIMIZED_JSON_SCHEMA=true
  Additionally enables strict OpenAI structured output in Pro. Requires
  V1_OPTIMIZED_PROMPTS=true. This does not enable JSON on FREE providers.
- V1_TIERED_ROUTING=true
  Uses lightweight model only for the explicit low-risk greeting whitelist.
  Requires V1_OPTIMIZED_PROMPTS=true.
- V1_OPENAI_SIMPLE_MODEL=gpt-4o-mini
  Model used when the conservative tier is eligible; must be available on the account.

## Important limitations
- Prompt caching cannot be guaranteed merely by a stable system string:
  provider eligibility and actual token threshold apply. V1 only measures
  usage reported in API responses; no fabricated prompt-cache hit.
- No new paid benchmarks have been executed. Test mocks are not proof that
  OpenAI/Groq/OpenRouter accept every setting on each current model.
- Existing result cache hits bypass live model calls. To measure new prompts,
  use a deliberate uncached staging comparison on real test cases.
- Structured JSON compatibility needs manual and automated validation for
  Web, Telegram, fast mode, supplement, Chinese↔Vietnamese and long passages.
- Keep flags off on production until the quality and price/latency matrix is
  acceptable. Do not silently change V1 translations for existing users.
- V1 Pro costs are estimates based on a price table, not provider invoices.

## Checklist for enabling
1. Run npm test and Telegram-specific tests.
2. Perform an API staging smoke test (without real user data) with optimization
   flags off/on for both directions and all contexts.
3. Check approved terminology precedence, preserved identifiers/names, and
   reverse translation fidelity.
4. Compare latency, input/output tokens, cacheRead tokens, cost estimates,
   parsing reliability, and failed/retry counts.
5. Enable one flag at a time, monitor results, then gradually deploy.
