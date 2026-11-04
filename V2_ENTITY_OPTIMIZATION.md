# V2.8 — Source-grounded entity detection and lean GPT context

Scope: `feature/translation-engine-v2` only. No merge or deployment.

- `ai/v2/entity-detection.js` builds bounded source-name candidates from clear
  source signals. Only high-signal JS matches are protected without Claude.
  Other candidates are explicitly classified in the *existing* Claude call
  as proper name, label, ordinary word or uncertain source term.
- Classified entities must be exact substrings of the source. A confirmed
  MongoDB glossary mapping wins over speculative model decisions. Source-span
  coverage prevents a longer approved term from suppressing a standalone
  name elsewhere in the same sentence.
- Repeated name validation counts only original occurrences not covered by
  approved mappings, avoiding unnecessary GPT repair calls.
- GPT receives source text, factual/intent analysis without redundant facts,
  confirmed glossary once and `protectedNames`. It no longer receives Claude
  study-only terms/patterns, a duplicate `names` array, or entity metadata.
  Its proper-name system instruction is shorter than V1's general rules.
- Uncertain names do not enter the approved glossary automatically. Existing
  repair and REVIEW status are retained for verified omissions.
- V2 cache version becomes `v2.8.0` to prevent replay of older translations.
  Existing caching, payment accounting and opt-in inspector stay unchanged.

Regression tests cover `芳华`, normal bank/transaction vocabulary,
Claude-detected novel names, approved-term overlaps, repeated name occurrences,
suppression of unverified lexical guesses, and avoiding unnecessary API calls.

Limitations: No deterministic algorithm can perfectly tell an arbitrary
Chinese proper name from an ordinary word without context. Qualitative
Claude confidence is not a calibrated probability; string presence does not
prove correct semantic attachment. No billable Claude/GPT A/B benchmark was
executed during this code change. For comparisons, use identical test cases,
disable translation-result cache via the existing explicit refresh facility,
and compare per-stage input/output tokens, latency, repair count, name recall
and false-positive rate before deciding on deployment.
