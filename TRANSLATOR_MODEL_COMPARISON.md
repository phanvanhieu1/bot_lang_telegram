# Manual GPT translator comparison

Branch: `feature/translation-engine-v2`

On the Chinese/Vietnamese PRO translation page, use **AI dịch chính** to
choose `GPT-4o` or **`GPT-4o mini` (default)**. The old browser preference
is migrated once to the new mini default, and later explicit selections are
saved normally. The choice applies to the next click on **Dịch**, for **V1** or **V2**.

This feature changes only the principal translation GPT call:
- V1: the primary `translateFull` request uses the selected model. V1
  supplemental GPT requests for already-cached translations stay on the
  existing model.
- V2: Claude analysis and independent verification remain unchanged.
  `translator` receives the selected model; **Repair always uses GPT-4o mini**
  even if `translator` uses GPT-4o.
- Existing prompts, selected audience, approved glossary, output options,
  pronunciation, and verification settings stay unchanged.
- FREE and English translation pages do not expose the selector.

**Fair comparisons:** V1 and V2 have separate per-model result-cache
namespaces so selecting GPT-4o never returns a GPT-4o-mini translation (or
vice versa). The first translation of a given text with a selected model
will be a new paid request; subsequent identical requests can hit that
model's cache. Use the explicit live rerun in the inspector only if a new
model call is required; it incurs API charges.

V2 cache keys include the new Repair model policy to avoid reusing old
GPT-4o Repair results when comparing fresh translations.

Model input is server-side allowlisted to `gpt-4o` and `gpt-4o-mini`.
Clients which do not specify a model retain existing V1/V2 routing and
legacy cache keys, including Telegram and older web clients.

V1 billing now prices the primary translation at the actual returned
model's rate; the independent GPT-4o verifier is priced separately.
History snapshots preserve the selected model for faithful replay.

Run `npm test` locally after pulling; no paid provider benchmark or full
local test run was executed by this GitHub edit.


## Cache semantics (fix)

- V1 PRO without a matched glossary term keeps using the existing shared
  per-model cache. When a personal approved glossary term matches (for example
  an approved PP mapping), V1 now caches the translation and extras under a
  private key derived from the **user ID + matched term IDs/versions/meanings**.
  Identical subsequent clicks reuse the result; a glossary edit, model switch,
  different user or context cannot reuse an incompatible translation.
- V2 caches completed `PASS` and `REVIEW` results per user. A cached
  `REVIEW` retains its issues and warning; it is not converted to `PASS`.
  `FAIL`, incomplete output, and invalid `REVIEW` results are excluded.
- Both modes bypass the cache only on the explicitly requested live
  `forceRefresh` action. Merely enabling the inspector is not a refresh.
- V1 keeps its back-translation-language warning in the cached record; a
  previously sanitized English reverse translation cannot trigger repeated
  GPT calls. Any optional verification requested for the first time can
  incur a call, but a completed verification is cached.
- Model choice, direction and glossary correctness checks stay in place.



## Vietnamese reverse-translation and fidelity update (2026-11-07)

- A Vietnamese source containing a Chinese name (such as `Đơn 澎湃 này đã xử lý chưa?`)
  is recognized as **vi → zh**, not blindly classified as Chinese solely
  because Han characters are present. This rule is shared by V1 Pro,
  optimized V1 prompt metadata, and V2.
- Main translation prompts place explicit target-language and semantic-fidelity
  constraints near the end of V1 legacy instructions; V1 optimized and V2
  translator prompts preserve clause-level agents, time, conditions, exclusions,
  operational actions, numbered instructions and handles.
- V1 sampling temperature is set to `0.1` for more repeatable wording,
  without changing the default selected model or adding an AI call.
- Reverse-translation validation detects additional English requests, clauses
  and short status phrases, including English sentences containing Chinese or
  accented Vietnamese proper names. A detected wrong-language
  `BACK_TRANSLATION` is **discarded**, while a valid main translation and
  vocabulary are kept. No automatic paid retry was added.
- V1 and V2 translation cache namespaces were updated once for the improved
  prompt/guard version. The first identical request after rollout is a miss;
  future repetitions still use cache, scoped by model and glossary as before.
- These changes fix *specific deterministic failure modes*. They do **not**
  establish measured improvement in semantic accuracy without side-by-side
  testing of real output against human-corrected examples.
- Regression cases: `tests/translation-quality-language-regression.test.js`.
  Run `npm test` before deployment; compare real V1/V2 outputs with the VPS
  baseline and report any specific remaining mistranslations.
