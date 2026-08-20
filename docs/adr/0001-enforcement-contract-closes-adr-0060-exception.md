# ADR-0001 (generation-4): the executable enforcement contract closes ADR-0060's temporary charter-rule-1 exception

**Status:** Accepted (lands with PR-1d, the final unit of the prompt-1 stack; authority ADR-0061 on `main`)
**Date:** 2026-08-20

ADR-0060 on `main` authorized the fourth generation under a temporary exception to charter rule 1
(fence every invariant in the same PR that states it), holding until an executable enforcement
contract existed for the new line. **That exception is closed, by name, here.** F1-F9 are now carried
by mechanism instead of prose on `generation-4`: the sixteen executable rules `E1..E16` behind the one
seam `Gen4EnforcementContract`, blocking in CI, each adversarially proven in `docs/proof-log.md`
(nineteen entries; the rule-to-entry mapping is checked in both directions), with `CONSTITUTION.md`
carrying the ratified text every rule reads. No durable fourth-generation code, schema, migration, or
production-path PR merges except through this contract.

The section 5A bootstrap this branch stands on, for the record ADR-0060's closure must cite: exactly
one authorized direct push (ADR-0061 R-5), SHA `71ef1955c3f65710ab5010832a67f27a2aa76cfe`, file list
`README.md` and nothing else (14 reviewable lines, byte-identical to the block captain-reviewed in
ADR-0061), followed in the same sitting by branch protection (ruleset `21103072`: pull request
required, zero required approvals per X-1, force push and deletion disabled, no bypass) proven live by
a platform-refused direct push. Every later commit, in this prompt and all nine that follow, arrives
by reviewed pull request; the bootstrap exception is spent and no later prompt may cite it.

Recorded in `DECISIONS.md` (generation-4 journal) as GD-001. Revert path: reverting this ADR reopens
no exception - the enforcement contract stays binding unless the captain supersedes it by a new
ratified ADR on `main`.
