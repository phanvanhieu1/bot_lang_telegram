# V2.9 — Token and provider-cost optimization

Scope: V2 `feature/translation-engine-v2` only. Do not merge or deploy without a
live quality/cost regression. V1 prompts, caches and translations are unchanged.

## What is already in place (not reimplemented)

- OpenAI Responses API sends stable `instructions` and separate `user` input.
  Anthropic Messages API likewise sends `system` and separate `user` messages.
- The GPT translator already uses strict JSON Schema responses.
- Claude's `max_tokens` ceiling already scales with input length, with at most
  one retry for malformed/truncated JSON.
- V2's owner-specific result cache lasts 14 days; prompt caching does NOT
  replace it. A full cache hit skips both AI stages.

## V2.9 changes

- English, reusable analyzer/translator system prompts are in
  `ai/v2/prompts-en.js`. User-specific context, source, dynamic analysis
  limits, protected names, verified glossary and translation settings remain
  in the USER JSON, never appended to the static cached prefix.
- Claude Analyzer now sends a supported JSON Schema via
  `output_config.format={type:'json_schema',schema:...}`.
  Source-grounding, strict post-parse checks and the existing truncated-
  response retry remain as safeguards. Structured JSON may itself add some
  provider-side input tokens; measure it rather than assuming savings.
- The Claude provider uses a **5-minute ephemeral cache breakpoint on the
  stable system block** (never on varying user data). Haiku 5.5 has a
  **512-token minimum prefix**: a shorter prompt will not create a cache,
  even with `cache_control` set. Cache lifetime is refreshed on reuse.
  The first write is 1.25x standard input price; hits are 0.1x for Haiku 5.5.
  Sonnet 5.5 read pricing is handled separately (0.05x).
- Input usage now counts `input_tokens + cache_creation_input_tokens +
  cache_read_input_tokens` for Anthropic, with separate per-stage
  cacheWriteTokens/cacheReadTokens/uncachedInputTokens.
  OpenAI Responses' automatic cache usage
  (`input_tokens_details.cached_tokens`) is tracked similarly.
  Approximate USD cost uses the relevant write/read rates; API statements
  remain the authoritative billing source.
- Optional conservative tiered routing can use GPT-4o-mini for very short,
  everyday Chinese→Vietnamese messages with no IDs, amounts, work domain,
  known glossary matches, unresolved ambiguities, confirmed names, negations
  or extra Chinese study/back-translation requirements. Any other request,
  including repair, stays on the configured full-quality GPT model.
  The tier decision uses only the existing Claude result and JS (no extra
  model/classifier request). Tier flags and the candidate model are part
  of the translation-result cache key.

## Environment

| Key | Default | Meaning |
| --- | --- | --- |
| V2_CLAUDE_PROMPT_CACHE | true | Set false to remove explicit cache breakpoint |
| V2_CLAUDE_JSON_SCHEMA | true | Set false for legacy text-JSON response |
| V2_TIERED_ROUTING | false | Opt in to conservative simple-message GPT routing |
| V2_OPENAI_SIMPLE_MODEL | gpt-4o-mini | Only used if tiered routing is on |
| V2_OPENAI_MODEL | gpt-4o | Full-quality translator and repair |
| V2_CLAUDE_MODEL | claude-haiku-5-5 | Analyzer |

Claude 3.5 Haiku and Claude 3.5 Sonnet are retired; do not configure them.
The lower-tier example model GPT-4o-mini is not the only possible choice and
may be deprecated; verify availability on your account before enabling
tiered routing. Opting in is optional; enable it only after checking translation
quality on real everyday messages.

## Acceptance criteria / benchmark

- Keep V2 quality regression tests passing for names, codes, financial
  instructions, glossary precedence, semantic fidelity and owner isolation.
- Do not infer a cache hit from a matching prompt alone: inspect real usage
  `cacheReadTokens`, `cacheWriteTokens`, per-stage input/output tokens,
  elapsed time and estimated cost. The static System Prompt may still be below
  the provider's actual cache threshold after tokenization.
- Compare V2.8 vs V2.9 on the same representative work/daily/IT messages
  with results-cache refresh **explicitly opted in** for paid A/B runs.
  Record name recall, false positives, glossary correctness, per-stage USD,
  retry count, delay and total tokens. Do not claim 90% overall savings.
- New engine version is V2.9.0; old engine cache keys invalidate naturally.
  After deployment first-run AI cost may rise until the new cache warms.
- No paid API benchmark was executed by the GitHub CI mock tests.
