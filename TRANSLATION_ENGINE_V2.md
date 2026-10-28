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
any unresolved mismatch or ambiguity is displayed as `REVIEW`.

### Context and ambiguity

- A workplace-only mapping does not apply to clear friend/daily-life context.
- Explicit `friend` selects daily-life terms; colleague/superior fallback to
  workplace if Claude cannot identify a better domain.
- Claude can identify IT in a conversation between coworkers.
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
