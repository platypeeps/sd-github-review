# Finding Adjudication Evidence Publication Implementation Plan

1. Freeze query, canonical-view, learning-projection, and
   effectiveness-projection fixtures.
2. Implement strict query decoding, store-response validation, event folding,
   freshness, coverage, exclusion, and truncation.
3. Implement one shared safe projection layer with consumer-specific fields.
4. Extend setup discovery and bounded GitHub receipt/status summaries.
5. Test privacy, determinism, pairing, deduplication, disputed evidence, stale
   data, unavailable storage, and unknown schema behavior.
