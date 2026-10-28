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

### Verified live G01/G02 (2026-10-28)

Owner-provided paid API report confirms G01 and G02 both returned
`termMatchOK:true`, `status:PASS`, and zero issues. G01 applied the
approved work meaning of `刷子`; G02 used the everyday brush meaning.
Latency was 11.26 seconds for G01 and 7.66 seconds for G02. These two
specific executions are verified; the broader holdout, staging DB, and
human semantic review remain outstanding.

**G08 expectation differs between mock and paid live mode.** Mock G08
deliberately forces OpenAI to refuse the glossary even after repair and
expects `REVIEW` with no applied terms. Real live G08 does not inject that
failure and **must apply `刷子`**, so it expects the approved term just
like G01. Do not interpret a correct G08 live translation as a test failure.

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

### Known limits

- An exact phrase match can produce a REVIEW even if a valid synonym is used.
- The automatic status checks term and code consistency, not full semantic
  correctness. Human review of nuanced instructions and negation is required.
- Provider model availability and account-level budgets are not verified until
  the owner's environment makes live calls.
- Never merge or deploy V2 until the synthetic paid smoke and production-like
  staging tests pass.

**Real provider calls and translation quality are not yet verified.**
On a staging VPS with your keys, first run the limited synthetic holdout:

```bash
node scripts/benchmark-translation-v2.js --dry-run --limit=5
node scripts/benchmark-translation-v2.js --limit=5 --domain=work
```

The script writes private JSON under the git-ignored `benchmarks/results/`.
Human-check unseen work, friends and IT cases, actual output cost and latency
before merge/deploy. No change to production is authorized by this PR.

**Relationship to PR #4:** PR #4 (optimized V1 context prompt) remains a
separate draft; this branch is based on `main`. Resolve the two branches'
shared V1 prompt changes intentionally if both are eventually merged.
