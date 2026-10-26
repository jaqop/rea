# Narrative fork architecture and provenance

REA Narrative 0.1.0 derives its investigation discipline from morluto/rea at commit `5508b2affd8bdd0788aed9d2246c373fd1b01bb7`. The original MIT license is retained. This is an independent narrative runtime, not a claim that disassemblers decode fiction.

The original EvidenceLedger, residualUnknown, typed tracing and finite reconstruction verification informed the design. Their software-specific schemas, binary sessions and graph types are not reused verbatim. New contracts live in `narrative/contracts.mjs`; source functions in `core.mjs`; persistent investigations in `store.mjs`; shared operations in `tools.mjs`; adapters in `cli.mjs` and `mcp.mjs`.

## Boundaries

- UTF-8 import retains decoded text including BOM and line endings. Citation offsets use absolute UTF-16 code units, start-inclusive/end-exclusive. Paragraphs preserve exact source ranges; chapter labels are heuristic.
- Book identity covers text content, not title or publication edition metadata. Edition authentication is not provided.
- Citations are checked for exact wording and range, not semantic entailment. A correctly quoted passage can still be misinterpreted.
- Mutation history chains state hashes. It detects inconsistent edits, but is not signed, does not authenticate authorship and cannot defeat someone rewriting all hashes. This is not independent truth verification.
- Per-investigation directory locks exclude simultaneous writers. Atomic replacement preserves previous committed state on serialization failure. A crashed writer may leave a lock directory; check no writer is active before removing that exact lock directory.
- Scenes are analyst inferences; mechanism cards remain untested hypotheses. Unknown resolution records an analyst decision. No operation measures reader effects or marks a mechanism empirically tested.
- Traces traverse declared scene dependencies and mechanism support links. Reachability does not prove causality.
- Transfer briefs omit source excerpts and scene prose, but use analyst-entered constraints, predictions and tests. Those fields can themselves be source-specific; originality requires review.
- Caller-selected file access only. No HTTP server, model API, automatic installs or network calls in the runtime. A connected assistant has its own data handling.
- Source files and serialized investigations each have a 16 MiB limit. Investigations duplicate passage text, so usable source size is lower. Large corpora require explicit splitting. Cross-book linking is not implemented.

## Distribution and upstream preservation

Historical software source remains in the checkout and Git history. The package allowlist ships only narrative runtime, workflow skill, guide and license. Original package metadata, README and contributor guidance are in `docs/upstream/`. Old software workflows have a `.disabled` suffix and do not execute. Active CI runs narrative checks on Windows, Linux and macOS.

Historical website/docs are not the narrative product documentation. Use the root README and narrative guide. Native-provider behavior and literary quality are outside this release's verification scope.

The old installer, MCP registry identity and submodule declarations are archived under `docs/upstream/`. Native-analysis gitlinks are removed from the active tree to prevent recursive installation of unrelated engines; their pinned commits remain in upstream history and the archived declarations. The original code was not built or tested as part of this conversion.
