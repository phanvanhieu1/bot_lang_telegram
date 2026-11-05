# Manual GPT translator comparison

Branch: `feature/translation-engine-v2`

On the Chinese/Vietnamese PRO translation page, use **AI dịch chính** to
choose `GPT-4o` (default) or `GPT-4o mini`. The selection is saved in this
browser and applies to the next click on **Dịch**, for either **V1** or **V2**.

This feature changes only the principal translation GPT call:
- V1: the primary `translateFull` request uses the selected model. V1
  supplemental GPT requests for already-cached translations stay on the
  existing model.
- V2: Claude analysis, existing GPT Repair, and independent verification
  keep their previous models. Only `translator` receives the override.
- Existing prompts, selected audience, approved glossary, output options,
  pronunciation, and verification settings stay unchanged.
- FREE and English translation pages do not expose the selector.

**Fair comparisons:** V1 and V2 have separate per-model result-cache
namespaces so selecting GPT-4o never returns a GPT-4o-mini translation (or
vice versa). The first translation of a given text with a selected model
will be a new paid request; subsequent identical requests can hit that
model's cache. Use the explicit live rerun in the inspector only if a new
model call is required; it incurs API charges.

Model input is server-side allowlisted to `gpt-4o` and `gpt-4o-mini`.
Clients which do not specify a model retain existing V1/V2 routing and
legacy cache keys, including Telegram and older web clients.

V1 billing now prices the primary translation at the actual returned
model's rate; the independent GPT-4o verifier is priced separately.
History snapshots preserve the selected model for faithful replay.

Run `npm test` locally after pulling; no paid provider benchmark or full
local test run was executed by this GitHub edit.
