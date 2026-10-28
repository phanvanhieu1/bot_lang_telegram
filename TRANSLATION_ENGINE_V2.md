# Translation Engine V2 (draft; not deployed)

**Goal:** Two separate translate buttons on Web PRO. The existing V1 path
(`POST /api/translate`) remains unchanged and is the DEFAULT.
The V2 button is a deliberate paid/deep translation request:
`POST /api/translate/v2`. It is hidden unless the server reports V2 ready.

### Pipeline

1. **Groq analyzer**, with OpenRouter fallback (and OpenAI as last-resort
   analyzer), extracts intent, conditional statements, negation, actors, domain,
   terminology and ambiguity into a short JSON frame.
2. **OpenAI and Claude independently translate** the original in parallel.
   Claude does not see OpenAI output or Groq's semantic hypothesis. If either
   essential paid provider fails, the V2 request FAILS rather than disguising
   a single translation as a verified multi-agent result.
3. **DeepL Free**, when available, supplies a third plain-text translation to
   compare. It is optional, and never determines the answer by voting.
4. **OpenRouter critic** (Groq fallback) examines both outputs, including
   omissions, tone, terminology, negation and action requests.
5. **OpenAI and Claude each audit the source and both candidates**. Both
   must agree on a preferred candidate for a PASS. Disagreements, unverifiable
   ambiguity or critic objections yield REVIEW, visible in the UI.
6. A REPAIR verdict requests **one targeted Claude revision**, independently
   checked again by **both OpenAI and Claude**. No unbounded repair loops.

The model's PASS is **not a guarantee** of correctness. Disagreement,
unresolved ambiguity and important missing codes/numbers must be disclosed.

### Credentials and enablement

The existing V1 API keys are preserved; no keys are committed.

```dotenv
# V2 disabled unless explicitly enabled AFTER testing:
V2_ENABLED=false
OPENAI_API_KEYS=your-openai-key
CLAUDE_API_KEY=your-claude-key
GROQ_API_KEY=your-groq-key
OPENROUTER_API_KEY=your-openrouter-key
DEEPL_API_KEY=your-deepl-key

# Optional overrides. Verify model availability for each API key:
V2_OPENAI_MODEL=gpt-6.1-sol
V2_CLAUDE_MODEL=claude-sonnet-5-5
V2_GROQ_MODEL=qwen/qwen3.8-27b
V2_OPENROUTER_MODEL=google/gemma-4-31b-it:free
V2_ALLOW_FREE_PROVIDERS=true
```

Aliases accepted by the V2 adapter: `OPENAI_API_KEY`, `OPENAI_API`,
`ANTHROPIC_API_KEY`, `CLAUDE_API`, `GROQ_API`,
`OPENROUTER_API`, `DEEPL_API`. Prefer the existing project key names.
Web PRO/admin accounts alone can run V2. Only **Chinese ↔ Vietnamese**
text up to 2,000 characters is currently supported.

### Security and privacy

Each third-party provider used in a V2 session receives the text; the
independent providers may have different data handling, retention and
free-tier policies. DO NOT send personal banking details, internal company
records, tokens, passwords, or employer messages unless permitted under
the organization's data-handling policy. Set `V2_ALLOW_FREE_PROVIDERS=false`
to avoid sending text to Groq, OpenRouter and DeepL; the core OpenAI+Claude
pipeline and their safety checks remain. No original text is written to V2
cache, history or logging by this feature.

V2 is **disabled by default**. It is not used when clicking the old button,
and does not automatically run after a V1 failure. There is a best-effort
one-active-V2-request gate per account/process, not a distributed usage quota;
set an external server-side quota/budget control before large-scale rollout.

### Cost and quality gates

The existing usage dashboard receives the **known paid-model estimated cost**
and all reported text tokens. This is **NOT an exact total invoice**: usage
from Groq, OpenRouter and DeepL may be billed differently and their cost is
not included in the initial estimate. The JSON response includes
`pricingIncomplete` so this is not mistaken for total spend.

1. Run `npm test` (offline, no credentials).
2. With test credentials set, enable V2 on a staging VPS only.
3. Compare V1 and V2 on a large **unseen** test set of workplace instructions,
   everyday friendship chats and dev conversations, not on the examples used
   to author prompts.
4. Record semantic mistakes, missed requests, numbers, financial terminology,
   social register, provider errors, latency and actual provider invoices.
5. Require independent human QA. Do not merge/deploy to production solely
   because the AI Auditor gives PASS.

This draft is based on `main`, independent from the unmerged V1 contextual
prompt PR #4.

### Local live quality evaluation (requires API keys, billable)

```bash
git fetch origin
git switch feature/translation-engine-v2
git pull --ff-only origin feature/translation-engine-v2
npm ci
npm test

# Offline: no API calls
node scripts/benchmark-translation-v2.js --dry-run --limit=5

# When valid test keys are configured in your local .env:
# Limit to five new holdout examples first; DO NOT run for real employer data.
node scripts/benchmark-translation-v2.js --limit=5 --domain=work

# Later, compare social register, technology and mixed context independently.
node scripts/benchmark-translation-v2.js --limit=10 --domain=friend
node scripts/benchmark-translation-v2.js --limit=10 --domain=it
```

Results are saved locally in ignored `benchmarks/results/` JSON files. No
provider credentials, requests or raw translation text are printed to server
logs; the CLI prints translations from **synthetic** holdout cases for review.

V2 is not currently a vocabulary/grammar/pronunciation tutor; those remain
V1 features. We should integrate the verified learning layer only after
translation accuracy has been evaluated independently.
