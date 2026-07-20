# HostParity platform capability request fixture

This source-contained fixture mirrors the semantic assertion used by
`scripts/test-host-parity-remaining.js` without reading workspace runtime state
outside the repository. It intentionally contains the platform request marker:

- `P-GROK-1`: Grok should expose a hard-blocking prompt/context injection or an
  equivalent trusted mechanism so DevCodex can make entry checks verifiable at
  the same assurance level as Codex where the host supports it.
