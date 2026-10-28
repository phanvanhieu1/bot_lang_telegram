# Terminology Memory + Translation Engine V2 (DRAFT)

This branch adds a user-confirmed bilingual terminology memory shared by
V1 FREE, V1 PRO and the opt-in V2 Web translator. Production/main is unchanged.

## How it works

**V1 FREE / PRO:** Look up approved, in-domain, user-owned terms in MongoDB
before translation; inject only matched mappings into the prompt. Existing
FREE providers Groq → OpenRouter continue; DeepL is NOT used when a required
term is matched, since it cannot accept an enforced glossary. PRO continues
using GPT-4o. The server checks exact required phrases after translation and
returns `terminologyWarnings` if a term was not applied. It does not silently
replace substrings in the translation or claim that an inaccurate answer passed.

**V2:** Claude analyzes original sentence into JSON (intent, tone, domain,
facts, uncertain terms). The server loads glossary matches **after** the
analysis, with the authenticated user ID. The resolver prioritizes the
confirmed database meaning whenever the entry matches the domain, over any
different meaning proposed by Claude. OpenAI receives original source text,
Claude analysis and the selected mandatory glossary mappings, and returns a
structured translation. Code validates required phrases and protected numeric
or code tokens. A mismatch triggers at most ONE targeted OpenAI correction;
unresolved glossary/numeric mismatches or **material** ambiguity that could alter the core meaning are displayed as `REVIEW`. Ordinary omitted details (such as the exact type of an object) remain advisory notes.

### Context and ambiguity

- A workplace-only mapping does not apply to clear friend/daily-life context.
- Explicit `friend` selects daily-life terms. Explicit `colleague` or
  `superior` prioritizes work terms **even if Claude guesses daily**; Claude
  may still identify a clearly technical IT message, which selects IT terms.
  This is a deliberate user-context override: if you are speaking to a
  colleague about ordinary household items, select the friend/daily context
  instead or use auto for content-driven interpretation.
- The resolver's effective domain is passed to OpenAI separately from Claude's
  original domain (retained in diagnostics). Claude term guesses that conflict
  with an approved DB entry are excluded from OpenAI's translation analysis.
- In `auto`, Claude's domain remains a hypothesis; no work glossary is
  forced when its analysis is daily/unknown.
- With `auto` and no domain evidence, specialized entries are deliberately
  not forced into the sentence. For ambiguous short workplace phrases such as
  `这是刷子吗？`, select **Đồng nghiệp** if you intend the work meaning.
- Longer phrase matches take precedence over overlapping shorter matches.
- A translation with no exactly matching confirmed target phrase is flagged,
  not silently marked verified; synonymous wordings may still need human review.

## Personal glossary

A Mongoose `translation_terminology` collection stores:
`owner, source, translation, sourceLang, targetLang, domain, priority,
status=approved, notes, version, timestamps`.

All operations and lookups are scoped to the logged-in MongoDB `User._id`:
`GET /api/terminology`, `POST /api/terminology`,
`PATCH /api/terminology/:id`, `DELETE /api/terminology/:id`.
The API validates field sizes and allowed domains and rejects duplicates.
Terms are **only approved by an explicit user save**, never automatically
written by Claude or OpenAI. The web details panel has a compact
`＋ Thuật ngữ` action, editor and a + button on each vocabulary card.
Use the form to save `刷子` as `đường dây bào khuyến mãi`, domain `work`.

The server produces exact, bounded `appliedTerms` spans only for target text
that contains a confirmed term. The browser renders marks with `textContent`
(no HTML injection) and shows warnings for missing terms.

## Cache correctness and privacy

V1 FREE and PRO existing cached translations are shared across accounts.
To prevent user A's custom meaning leaking into user B's translation, V1
**never reads or writes the shared cache for requests with a matched personal
glossary entry**. No cache-wide deletion or stale-version race is required:
after edits, applicable requests are reevaluated and cannot reuse a shared
pre-glossary result. Requests without matched terms keep existing caching.

Glossary lookups, updates and deletes always require a real authenticated user.
The vocabulary is not shared by default. Because V2 sends original text and
matched terms to Claude/OpenAI, only use employer content if authorized by the
employer's data handling rules. Other providers' data policies also apply when
V1 FREE is used. No API keys or model responses are logged by this feature.

## Enablement

V2 remains disabled by default: `V2_ENABLED=false`. To test in staging, use
`OPENAI_API_KEYS` (or `OPENAI_API_KEY`) and `CLAUDE_API_KEY` in the
LOCAL `.env` file, then set `V2_ENABLED=true`. The existing V1 button is
the default and the separate V2 button only appears for eligible PRO/admin
users after `/api/translate/v2/status` confirms availability.

Provider model overrides:
`V2_OPENAI_MODEL`, `V2_CLAUDE_MODEL`. Model access varies by paid key.
V2 responses report aggregate tokens and an estimated cost only for recognized
priced models; do not confuse these estimates with the provider invoices.

### Faster V2 model trial (2026-10-29)

V2 defaults have changed **only on this feature branch**:
- Claude analysis: `claude-haiku-5-5` (previous `claude-sonnet-5-5`), using
  `output_config.effort = low`.
- OpenAI translation/repair: `gpt-6.1-terra` (previous `gpt-6.1-sol`), using
  `reasoning.effort = none`. JSON schema and deterministic terminology /
  number validation remain unchanged; this is **not** a quality guarantee.
- Updated V2 accounting estimates: Haiku 5.5 $0.10 input / $0.50 output per
  million tokens for standard prompts below 100K tokens; Terra $1 input /
  $5 output per million. Sonnet 5.5 and Sol legacy prices remain recognized.
  Actual invoices may differ. No live paid model requests were sent for this
  code change.
- `requestUsage.stages[].ms` reports actual AI stage latency; the V2
  `requestUsage.elapsedMs` reports time spent in the server's V2 handler.
  Both appear in the translation UI alongside tokens and USD.
- Cache fingerprints now include **model IDs and effort levels**. First request
  after switching models/effort is a miss; a later successful `PASS` can hit.
  Old cached results are not deleted, just isolated by key.

If `.env` already specifies `V2_CLAUDE_MODEL` or `V2_OPENAI_MODEL`, it
**overrides** the new fast defaults. For an explicit trial use:

```dotenv
V2_ENABLED=true
V2_CLAUDE_MODEL=claude-haiku-5-5
V2_CLAUDE_EFFORT=low
V2_OPENAI_MODEL=gpt-6.1-terra
V2_OPENAI_REASONING_EFFORT=none
```

To restore the previous deep models, set:

```dotenv
V2_CLAUDE_MODEL=claude-sonnet-5-5
V2_OPENAI_MODEL=gpt-6.1-sol
V2_OPENAI_REASONING_EFFORT=medium
```

Unset `V2_CLAUDE_EFFORT` when returning to the old model if you want its
original default effort. Restart the web server after editing `.env`.

Manual interface comparison: use a new sentence (cache MISS), compare V2
latency, token counts and USD; repeat the same input to check cache HIT.
Also compare nuanced workplace/ambiguous sentences against the previous
configuration, preserving any terminology manually approved in MongoDB.


## Testing

```bash
git fetch origin
git switch feature/translation-engine-v2
git pull --ff-only origin feature/translation-engine-v2
npm ci
npm test
```

Offline tests cover owner scoping, domain matching, longest phrase, metadata
spans, cache isolation, Claude/DB conflict handling, structured output,
OpenAI correction and clean failure on missing DB/provider.

## Recovery for truncated provider JSON (2026-10-28)

The first live G01/G02 smoke after reducing Claude output limits showed:
G02 returned a correct translation and PASS, while G01 returned
`V2_INVALID_AGENT_JSON` without a provider-stage diagnosis.
G02 already consumed 473 Claude output tokens near the previous 480-token
limit, so truncation is a plausible cause; the previous error report did not
contain enough detail to prove exactly which stage failed.

The engine now starts Claude at an 800-token **maximum** for short texts
(a cap, not tokens requested), checks the Anthropic `stop_reason`, and
retries **only analysis, at most once**, with a larger cap when the result
was truncated or the JSON was structurally invalid. Valid concise results
still use only the tokens the model emits. It never retries on ordinary
network failures or failed credentials.

Failed live reports now contain sanitized
`failedStage`, `attempts`, `firstError`, `lastError`, and
`failedStages` (usage/timing only). OpenAI malformed/incomplete JSON
is identified separately as `V2_OPENAI_TRANSLATION_INVALID_JSON` or
`V2_OPENAI_TRANSLATION_INCOMPLETE`. No raw model text, keys or
headers are written in these diagnostics.

Rerun only the two synthetic inputs first:

```bash
git fetch origin
git switch feature/translation-engine-v2
git pull --ff-only origin feature/translation-engine-v2
npm test
node scripts/smoke-translation-v2.js --mode=live --accept-paid=true --glossary=fixture --ids=G01,G02
```

If a live call fails again, report the record containing `failedStage`
and `failedStages`. A failed analysis retry may still incur tokens from
both Claude calls, so compare usage/cost before expanding the test.

## G01 glossary precedence regression (2026-10-28)

The second live G01 run had valid Claude/OpenAI JSON but **failed glossary
matching**: Claude classified the ambiguous work sentence as `daily`
despite the explicitly selected `colleague` context. The old resolver
trusted Claude and skipped the approved work term `刷子`, causing OpenAI to
produce the ordinary brush meaning. The report correctly recorded
`termMatchOK:false` although the engine status was `PASS`.

The fixed resolver gives explicit colleague/superior work context priority
over Claude's daily guess, while retaining technical IT and friend/daily
separation. V2 sends the resolved domain and only the DB-confirmed meaning
to OpenAI; the original analyzer domain is still returned for transparency.

Re-test the exact conflict with the fixture `G01` whose mocked Claude
domain is deliberately `daily`, then run the two paid synthetic cases:

```bash
npm test
node scripts/smoke-translation-v2.js --mode=mock --ids=G01,G02
node scripts/smoke-translation-v2.js --mode=live --accept-paid=true --glossary=fixture --ids=G01,G02
```

A successful live G01 should show `analysis.domain:"daily"` if Claude
continues to guess that, `analysis.resolvedDomain:"work"`,
`actualTerms:["刷子"]`, and `termMatchOK:true`. The translation itself
still needs human semantic review. These changes were made to the resolver
and precedence policy, **not** by inserting G01 into any AI prompt.

## Integration smoke: glossary and live provider compatibility

The legacy `benchmark-translation-v2.js` benchmark intentionally tests
general semantics **without user glossary data**. Do NOT use it as proof that
MongoDB terminology overrides Claude.

The dedicated smoke runner covers eight synthetic cases including an
AI interpretation of `刷子` as `bàn chải`, an approved workplace meaning
`đường dây bào khuyến mãi`, a normal shopping context, long-phrase
precedence, IT context and an OpenAI translation that refuses the term.

```bash
# 1. No database, no API key, no network requests:
node scripts/smoke-translation-v2.js --dry-run
node scripts/smoke-translation-v2.js --mode=mock
# Inspect the private JSON saved under benchmarks/results/

# 2. Paid live provider calls, OPT-IN ONLY, using synthetic glossary records:
# Keep your existing OPENAI_API_KEYS and CLAUDE_API_KEY in local .env
node scripts/smoke-translation-v2.js --mode=live --accept-paid=true --glossary=fixture --ids=G01,G02

# 3. Expand the live synthetic test after verifying actual costs:
node scripts/smoke-translation-v2.js --mode=live --accept-paid=true --glossary=fixture --limit=8
```

### Verified live glossary fixtures G01-G08 (2026-10-28)

The owner supplied full paid-provider reports for both batches: G01/G02
and G03-G08. All **8/8** returned `termMatchOK:true`, `status:PASS`, and
zero reported issues. The six new paid outputs are now replayed by
`tests/translation-v2-live-regression.test.js` without API calls. This
replay prevents regression but is **not** an independent semantic audit.

| Cases | Verified behavior |
| --- | --- |
| G01 / G08 | Approved `刷子` work terminology applied |
| G02 / G04 | Ordinary brush translation, no work override |
| G03 | Automatic work recognition, approved term and instruction preserved |
| G05 | `403` and `401` preserved with negation |
| G06 | Long phrase `这笔出款` wins over `出款` |
| G07 | IT `刷子` / `module Brush` wins over work meaning |

Measured sequential total latency was **70.684 s** (8.836 s per request
on average). Claude analyzer stages consumed **48.175 s**; OpenAI
translator stages consumed **22.497 s**. Total tokens reported were
**8,542 input** and **5,157 output**, including **4,727 Claude output**
tokens. Do not tighten the Claude output cap solely based on latency:
the earlier 480-token cap caused suspected truncation.

Two linguistic nuances remain for manual review: G03's 'có phải là đường
dây' is less natural than 'có phải thuộc đường dây'; G04's context-free
`刷子` can refer to several kinds of brush. Neither is a glossary-matching
failure. Automatic PASS is **not** certification of semantic accuracy.

**G08 expectation differs between mock and paid live mode.** Mock G08
deliberately forces an incorrect translation after repair and expects
`REVIEW`. Real live G08 does not inject that failure and expects the
approved `刷子` terminology. The owner-supplied run confirms the latter.

The remaining release gates are a production-like **staging MongoDB**
glossary integration test and human review of the **35-case unseen**
semantic holdout, with costs/latency recorded. No merge/deployment
is authorized by these smoke results.

No mock or synthetic fixture is automatically stored in production MongoDB.

**Optional staging-only read from MongoDB** (never uses `MONGODB_URI`):
Set `V2_TEST_MONGODB_URI` to an independently verified **staging** database,
`V2_TEST_USER_ID` to an existing staging user ObjectId, and
`V2_ALLOW_STAGING_DB_READ=true`. Pre-populate the *staging* glossary through
the normal authenticated UI; the smoke CLI does not seed or modify data.

```bash
node scripts/smoke-translation-v2.js --mode=live --accept-paid=true --glossary=db --ids=G01
```

Do not set the staging read flag against production. A DB-smoke result may
have zero matches until you add the exact confirmed test term to that
staging user's glossary. Verify the `actualTerms` array in the report.

The run always writes a private JSON report to ignored
`benchmarks/results/` with the translation, status, matched terms,
per-provider timing/tokens, and warnings. The mock result validates pipeline plumbing, **not** linguistic quality.
In live runs, `plumbingOK` is deliberately null rather than an automatic PASS.
`termMatchOK` evaluates expected glossary phrases only; the summary reports
`liveTermMatches` and `semanticQualityReviewed:false`. Actual translations
still require human judgment.
Paid runs refuse to start unless both API keys are configured and
`--accept-paid=true` is supplied. Do not paste keys into chat or GitHub.

### C01-C05 paid semantic holdout (2026-10-28)

The owner supplied five new paid Claude/OpenAI results from the work holdout.
Manual reading against the Chinese originals found no material loss of
conditions, negation, processing sequence, or deadlines in **5/5**.
C02 has a fluency defect ("đã đang theo dõi"), despite preserving the
meaning that Finance had started and is still following up. This is a
**quality note**, not an API error or verified automatic failure.

Reported latency was **33.731 seconds** in total (**6.746 seconds**
per request), with **21.372 seconds** in Claude analysis and **12.355
seconds** in OpenAI translation. Total reported usage: **5,275 input**
and **2,678 output tokens**. These are observed values, not a latency
or quality guarantee.

The translator now receives a general Vietnamese aspect/fluency
instruction. This is deliberately **not** a hardcoded correction for
C02, and its effect requires another live model run before being
claimed as fixed.

For C03 the analyzer selected `mixed`; domain normalization now
preserves `resolvedDomain:"mixed"` instead of reporting `unknown`.
With automatic context, only domain-neutral (`any`) glossary terms
may apply. This conservative rule avoids silently forcing a `work`
or `it` meaning when classification is mixed.

Historical snapshots are replayed offline in the
`translation-v2-live-regression.test.js` tests; they cannot verify
the quality of future model outputs. The remaining 30 holdout cases
and staging MongoDB glossary tests had not yet been executed at that point.
For the next five work samples only, without paying again for C01-C05:

```bash
node scripts/benchmark-translation-v2.js --dry-run --ids=C06,C07,C08,C09,C10 --domain=work
node scripts/benchmark-translation-v2.js --ids=C06,C07,C08,C09,C10 --domain=work
```

The paid command executes only the requested IDs, in their specified order,
and writes a private JSON result. Unknown, repeated, or off-domain IDs fail
before any provider request. Review all new model outputs manually.

### C02 recheck and C06-C10 work holdout (2026-10-28)

The owner provided six more paid provider records: C02 rerun plus C06-C10.
All six were model PASS with zero validator issues. Manual review found
the Chinese source meaning (negation, instructions, ordering, timing)
preserved in each case. **C02's previous awkward 'đã đang' phrase has
disappeared in the paid rerun**; the output now naturally uses
'bên tài chính đang theo dõi xử lý rồi'. This is one verified improvement,
not a guarantee the phrasing is fixed for every similar sentence.

The six calls took **44.128 seconds total**, averaging **7.355 seconds**;
the Claude stages took **29.340 seconds**, the OpenAI stages
**14.785 seconds**. Usage total: **6,502 input tokens** and
**3,586 output tokens**. This batch contains a repeated C02, so
**10 distinct work holdout cases** (C01-C10) have now been run,
with **25 remaining** across friend/IT/mixed.

**C09 classification issue:** the source is an organizational
withdrawal-limit / customer-support instruction, but Claude selected
`domain:"daily"` and the engine preserved `resolvedDomain:"daily"`
under auto context. The translation was semantically correct, but this
could suppress confirmed work-only glossary entries. We have tightened
the analyzer's **general** work-vs-personal classification guidance
without embedding C09 in the model prompt. Do not forcibly override
the analyzer's classification using finance words alone: an ordinary
personal purchase must not inherit workplace glossary entries.

The holdout CLI now records `domainReviewSuggested:true` and increments
`domainReviewCount` when an expected work/IT case resolves to daily/
unknown (or a friend case resolves outside daily). This is a
**non-blocking human-review flag**, distinct from model PASS and
the engine's `issues` array. IT or mixed within work examples
is not automatically flagged (e.g. C03, C05).

The updated analyzer domain guidance **still needs a paid C09 recheck**;
historical snapshots in offline tests reproduce the observed mistake
on purpose, rather than claiming it was fixed. Staging MongoDB
glossary integration has not been validated.

```bash
# Confirm the analyzer's new work classification without rerunning other paid cases:
node scripts/benchmark-translation-v2.js --dry-run --ids=C09 --domain=work
node scripts/benchmark-translation-v2.js --ids=C09 --domain=work

# After checking C09, continue with new daily conversation cases:
node scripts/benchmark-translation-v2.js --ids=F01,F02,F03,F04,F05 --domain=friend
```

### Bidirectional personal glossary and Vietnamese input (2026-10-28)

**Implemented in PR #5 only, not merged or deployed.**

The glossary editor now lets the authenticated owner choose **Chinese → Vietnamese**
or **Vietnamese → Chinese**. The optional **"Áp dụng cho cả hai chiều dịch"**
checkbox explicitly approves using the same pair in reverse. This is
important for polysemous terms: an existing Chinese → Vietnamese record
will **remain one-way** until the owner intentionally opts in. No
migration silently adds a reverse approval or inserts a second record.

For example, one approved work entry:

- Source Chinese: `刷子`
- Meaning Vietnamese: `đường dây bào khuyến mãi`
- Scope: `work`
- Reverse approval: **checked by the owner**

can match `刷子` on Chinese input or `đường dây bào khuyến mãi` on
Vietnamese input. A reversed lookup swaps the term's source and
translation **in memory**, without writing another MongoDB document.
Owner, approval status, exact language direction, domain and longest
phrase priority still apply. The same user-scoped resolver is used by
V1 and V2; matching personalized terms bypass shared translation caches.

V2 already detects Chinese input versus Vietnamese input; the
Claude analysis now receives explicit source/target languages and the
OpenAI prompt selects **natural Vietnamese** for Chinese input or
**simplified Chinese** for Vietnamese input. The API also returns
`sourceLanguage` and `targetLanguage` for display or client use.
Offline test G09 exercises the reversed approved phrase and confirms
that switching off the opt-in prevents reverse glossary application.

**Staging database read check, no AI charges:**

1. On an independently verified **staging MongoDB**, use a staging
   user account to create the work term above in the glossary editor
   and explicitly check the bidirectional option.
2. Configure local `V2_TEST_MONGODB_URI` and
   `V2_TEST_USER_ID` (staging user ObjectId), then explicitly set
   `V2_ALLOW_STAGING_DB_READ=true`. Do not reuse the production URI.
3. Run:

```bash
npm test
node scripts/smoke-translation-v2.js --mode=mock --ids=G01,G09
node scripts/verify-staging-terms.js
```

The staging checker uses read-only `find` queries for G01
(Chinese → Vietnamese) and G09 (Vietnamese → Chinese), prints term
matches and exits nonzero unless both expected mappings are present.
It does **not** call paid providers, write to MongoDB or import fixture
terms. The owner must configure independent staging credentials before
a real DB pass can be claimed.

### Known limits

- An exact phrase match can produce a REVIEW even if a valid synonym is used.
- The automatic status checks term and code consistency, not full semantic
  correctness. Human review of nuanced instructions and negation is required.
- Provider model availability and account-level budgets are not verified until
  the owner's environment makes live calls.
- Never merge or deploy V2 until the synthetic paid smoke and production-like
  staging tests pass.

**Real provider integration is verified for eight synthetic glossary cases; semantic quality and staging integration are not yet independently verified.**
On a staging VPS with your own configured keys, continue the remaining holdout in small batches:

```bash
node scripts/benchmark-translation-v2.js --dry-run --ids=F01,F02,F03,F04,F05 --domain=friend
node scripts/benchmark-translation-v2.js --ids=F01,F02,F03,F04,F05 --domain=friend
```

The script writes private JSON under the git-ignored `benchmarks/results/`.
Human-check unseen work, friends and IT cases, actual output cost and latency
before merge/deploy. No change to production is authorized by this PR.

**Relationship to PR #4:** PR #4 (optimized V1 context prompt) remains a
separate draft; this branch is based on `main`. Resolve the two branches'
shared V1 prompt changes intentionally if both are eventually merged.

## V2 user-scoped cache and per-click billing table

- V2 stores only `PASS` translations in MongoDB collection
  `translation_v2_cache`, TTL **14 days**. A `REVIEW` answer is not cached.
- Keys include account ID, trimmed original text, user-selected context,
  auto-detected translation direction, V2 engine version, actual configured
  Claude/OpenAI model IDs, and SHA-256 of the logged-in owner's entire
  approved terminology mapping. Editing, adding, removing, or changing the
  bidirectional approval of a glossary record changes that fingerprint.
  No personal term is shared between accounts.
- The server rechecks the glossary fingerprint after the LLM call, so it does
  not populate a stale cache if an approved meaning was edited mid-request.
  Reads also enforce expiry even before MongoDB's TTL cleanup runs.
- A cached response returns `cached:true` and per-click usage
  `{inputTokens:0,outputTokens:0,totalTokens:0,estimatedCostUsd:0}`.
  No new usage billing record is inserted on the cache-hit path.
- Each successful V1 FREE, V1 PRO and V2 text translation returns an
  additional `requestUsage` field without breaking the older `usage` field.
  The UI shows a small **Token & chi phí lượt dịch** table directly under the
  translation, including cache hit/miss, input/output tokens, price estimate
  and model-level stages where supported.
- V1 PRO pricing currently follows the existing GPT-4o accounting rates:
  input $2.50/million tokens, output $10/million. V2 pricing is sourced
  from `ai/v2/accounting.js`. Prices are **estimates**, not invoices.
  FREE providers with missing token reports or unknown billing rates show
  `—` instead of pretending the cost is $0.
- The table reflects only tokens and calls made **for the current click**:
  a cache HIT is $0 additional AI cost even if the initial cached result
  previously incurred an expense. Groq/OpenRouter FREE token counts are
  carried from provider usage metadata where available.

### Manual browser QA (no staging-test script required)

1. Pull `feature/translation-engine-v2`, restart the existing website with
   its ordinary MongoDB configuration, and log in with PRO/Admin access.
   Enable V2 with `V2_ENABLED=true` and your existing Claude/OpenAI keys.
2. Enter a short Chinese sentence and click **Dịch chuyên sâu V2**.
   Expect `CACHE MISS`, a per-provider input/output/cost table and a result.
3. Click V2 again without changing text/context. If the first result was
   `PASS`, expect `CACHE HIT`, zero new tokens, and $0 new AI cost.
   If the first result was `REVIEW`, expect it **not** to hit the cache.
4. Switch between **Bạn bè** and **Đồng nghiệp**. Expect independent cache
   entries. Add/edit a glossary entry, translate the same sentence again and
   expect a cache miss because the glossary signature changed.
5. Click the original **Dịch** button in PRO mode: V1's GPT-4o token and
   estimated cost appear. Repeat a cacheable request: expect zero incremental
   usage. Do the same in FREE mode: a missing provider tariff displays `—`.
6. Confirm that the usage table is cleared when starting another translation
   or clearing the input. No `V2_TEST_MONGODB_URI` or staging user ID is
   needed for any of these normal interface flows.

