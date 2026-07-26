# Cheap Review Reasoning Effort Implementation Plan

1. Research the pinned PR-Agent/LiteLLM path and record proven, unsupported,
   ignored, and unknown reasoning-capability fixtures.
2. Add provider-neutral candidate-catalog capability and policy validation.
3. Implement candidate-bound adapter translation only for proven mappings;
   omit unsupported controls and reject malformed or unprovable claims.
4. Emit bounded configured-versus-actual evidence when the provider supplies
   an observable actual mode.
5. Document the Qwen omit decision, qualification steps for future candidates,
   rollback, and separation from Copilot review effort.

Validate supported, unsupported, ignored, malformed, and raised-effort cases,
including cost/quality evidence for every non-minimal level.
