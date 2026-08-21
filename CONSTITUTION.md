# The generation-4 constitution

The binding rule set for every change on `generation-4`. It lands by PR against the bootstrap root (PR-1a)
and changes only by PR; its closed lists and ceilings are ratchets, and a conflict with a captain ruling is
resolved by a captain ADR, never a silent edit. `main` is the read-only oracle (DC-2); this branch is not the
default branch; the one bootstrap push is spent, so every later commit arrives by reviewed pull request,
enforced by branch protection (ruleset 21103072) and the enforcement contract: rules `E1..E16` under
`enforcement/` behind the single seam `Gen4EnforcementContract` (`evaluateEnforcement`), proven in
`docs/proof-log.md`, whose rule-to-entry mapping CI checks in both directions. The authority for this
branch's existence is ADR-0061 on `main` (with `DECISIONS.md` D-272), never a prompt file.

## The seven delivery constraints (DC-1..DC-7, ratified by name in ADR-0061 R-3)

- **DC-1.** The product and the GitHub repository stay named **Verin**.
- **DC-2.** Current `main` and all old history are preserved as the **read-only** behavioral,
  compatibility, and evidence oracle. The oracle is never edited to agree with the replacement.
- **DC-3.** After, and **only** after, explicit captain ratification, a clean `generation-4` **orphan**
  branch is created in the same repository.
- **DC-4.** All rebuild pull requests target **`generation-4`**, never current `main`.
- **DC-5.** No unrelated old history is merged into the orphan branch. Only individually justified
  semantics, tests, or code are ported, after characterization.
- **DC-6.** No change to the default branch, no tenant cutover, no retirement of the old runtime, and
  no real external effect, without separate explicit captain approval against exact evidence.
- **DC-7.** **No branch is authorized by this document, and none exists merely because a prompt
  describes it.** The authority is the ADR in R-1, not this file.

## F1-F9, restated as binding (full text: `CHARTER.md` on `main`; authority ADR-0060/ADR-0061)

- **F1.** Exactly one controlled fourth implementation generation is authorized, built beside the current system.
- **F2.** Current Verin is the preserved read-only legacy oracle; the replacement is measured against it.
- **F3.** Destructive replacement is prohibited, and no design may leave two systems able to issue the same
  external instruction: shadowing, rollback, and cutover are single-effect by construction.
- **F4.** There is no fifth rewrite. If generation-4 cannot reach its gates, fix it in place or stop.
- **F5.** Inherited truth binds until individually falsified through governed evidence, never by age or redesign.
- **F6.** No replacement architecture was selected by the amendment; naming a candidate does not choose it.
- **F7.** The direction came from a matched disposable three-arm comparison; the arms are discarded, only their
  measurements and findings survive.
- **F8.** The separate captain decision F8 requires is ADR-0061: it ratified a direction, promoted no arm.
- **F9.** Cutover and legacy retirement are the captain's, come last, and are implied by no other gate passing.

## The sixteen non-negotiables, carried forward architecture-neutrally

Substance from `CHARTER.md` on `main`; each names the mechanism that enforces it here and the slice that lands
that mechanism (#11, #14, #15 as ruled in ADR-0061 R-6). A row with no mechanism and no slice is the failure
this contract exists to end; none is permitted.

| # | Substance (architecture-neutral) | Mechanism | Lands |
|---|---|---|---|
| 1 | Every invariant is fenced in the PR that states it, proven adversarially | `E8` + `docs/proof-log.md` total mapping | slice 1 |
| 2 | Canonical schema and provenance before any adapter; no speculative fields | `EvidenceBundle` provenance model + `E7` | slice 3 |
| 3 | No unlabeled synthetic data, through derived artifacts | `E7 provenance` (source/asOf on every displayed value) | slice 1 rule; every UI slice |
| 4 | Detection is not verification: every PASS check has a companion | `E8 companion-proof` | slice 1 |
| 5 | Nothing built-but-not-shipped; no dead exports, no mock theater | `E6 reachability` | slice 1 rule; every slice |
| 6 | Human-in-the-loop in the core contract (suspend / await / resume) | `ExecutionAttempt` approval semantics | slice 7 |
| 7 | Multi-tenancy and config hygiene from day one; no client-trusted authority | `AccessContext` tenant authority + `E13` | slice 2 |
| 8 | End-to-end browser proof from the first flow | Playwright gate in the walking skeleton | slice 2 |
| 9 | Accessibility from the first primitive (WCAG 2.2 AA, axe in CI) | axe gate in the walking skeleton | slice 2 |
| 10 | The presentation tier is a first-class product surface | walking-skeleton product surface + its gates | slice 2 |
| 11 | Non-functionals measured, not modeled (p95, LCP, pilot-scale load) | prompt 10 deliverable 6 load gate (pinned k6) | slice 10 |
| 12 | Identity is foundation: real auth, server-side authorization only | `AccessContext` (real session, server RBAC) | slice 2 |
| 13 | The audit trail is tamper-evident and mechanically verifiable | `DecisionRecord` append-only ledger + replay | slice 6 |
| 14 | Observability from commit #1: traces, metrics, logs on every step | emission: `E16` + prompt 2 governed runtime and first instrumented route, then slices 3-9 register and exercise; SLOs/alerting: prompt 10 deliverable 15 | slices 1, 2, 10 |
| 15 | Supply-chain and security scanning as blocking CI gates | `E11..E15`, blocking, never advisory | slice 1 |
| 16 | External writes are idempotent and provably retry-safe | `ExecutionAttempt` idempotency + replay proof | slices 7, 9 |

## The ten-slice roadmap and its closed seam list (the `E4` list; exactly one seam id per PR)

| Slice | Prompt | Seam id | Scope in one phrase |
|---|---|---|---|
| 1 | 01 | `Gen4EnforcementContract` | ratification, orphan root, executable enforcement contract |
| 2 | 02 | `AccessContext` | identity, tenant authority, dependency baseline, walking skeleton |
| 3 | 03 | `EvidenceBundle` | evidence assembly, provenance, PII containment |
| 4 | 04 | `PolicyVersionRegistry` | content-addressed historical firm configuration |
| 5 | 05 | `DecisionOutcome` | deterministic decision module, produced-versus-signed proof |
| 6 | 06 | `DecisionRecord` | append-only decision ledger, deterministic replay, continuity |
| 7 | 07 | `ExecutionAttempt` | approval, reservation, retry-safe execution, reconciliation |
| 8 | 08 | `ConfigurationProposal` | governed self-configuration loop |
| 9 | 09 | `ProviderContract` | the real Salesforce path; the program's one port |
| 10 | 10 | `ActivationEvidence` | the F9 activation evidence package; no cutover |

## The review budget (what `E5` measures every PR against)

**A reviewable text line is any text line a human authored, whatever file it lives in** - code, tests, text
fixtures, snapshots, configuration, CI workflows, migrations, schemas, ADRs, runbooks, evidence manifests and
documentation all count in **bucket H** and all count the same. Two buckets sit outside the line count, each
with its own ceilings: **bucket G** (generated-deterministic artifacts) qualifies an artifact only when its
regeneration is proven byte-identical by a regenerate-and-byte-compare step in the blocking job AND a bounded
hand-authored diff summary of at most 40 lines ships in the same PR (that summary counts in H); **bucket B**
(binary and captured-evidence artifacts) is bound by artifact-count and gross-byte ceilings, and every B
artifact appears in a review gallery listing SHA-256, byte size, authorship or capture command, purpose, and
the reviewer's inspection command. The classifier is exhaustive and ordered: proven-G, else binary/captured B,
else text H; a changed path landing in zero or two buckets fails `E5`. A text artifact failing G is
reclassified to H and counted line by line; a binary failing G is reclassified to B. Review minutes are
bucket H at 8 lines per minute plus bucket B at 2 artifacts per minute, rounded to the nearest whole minute,
halves up - identically in all ten prompts. **Crossing any ceiling in any bucket forces a vertical restack,
never a waiver and never a reclassification of convenience.** Ceilings are per slice class; a later slice's
ratified prompt adds its class's row-set here before that slice's first PR merges, and `E5` fails closed on a
declared slice class with no ceilings recorded in this table.

| Slice class `enforcement/contract` - measure | Preferred | Hard |
|---|---:|---:|
| Bucket H, reviewable text lines | 250 | 400 |
| Files touched | 8 | 12 |
| Canonical owners touched | 1 | 1 |
| New public seam symbols | 2 | 3 |
| New database objects | 0 | 0 |
| New direct dependencies, application/runtime allowlist | 0 | 0 |
| New direct dependencies, development/test/build allowlist | 0 | 0 |
| Bucket G, generated-deterministic artifacts | 8 files / 3 MB | 16 files / 8 MB |
| Bucket B, binary and captured-evidence artifacts | 4 files / 3 MB | 8 files / 6 MB |
| Review surface (H at 8 lines/min + B at 2 artifacts/min) | 33 min | 54 min |

The `foundation-seam` row-set below is prompt 2 section 7's ratified table in `E5`'s own measure names and
numeric formats (the transcription the row-set above received). Its one first-recording adjustment is
captain-ruled (2026-08-20, `DECISIONS.md` GD-002): Files touched hard is 32 - the 26 predates `E5`'s
file-counting semantics, and mandated bookkeeping plus committed evidence is 15 files before product code.
Once recorded, every value here is a downward-only ratchet like any other.

| Slice class `foundation-seam` - measure | Preferred | Hard |
|---|---:|---:|
| Bucket H, reviewable text lines | 700 | 1,100 |
| Files touched | 18 | 32 |
| Canonical owners touched | 2 | 3 |
| New public seam symbols | 3 | 5 |
| New database objects | 10 | 16 |
| New direct dependencies, application/runtime allowlist | 11 | 13 |
| New direct dependencies, development/test/build allowlist | 13 | 15 |
| Bucket G, generated-deterministic artifacts | 8 files / 3 MB | 16 files / 8 MB |
| Bucket B, binary and captured-evidence artifacts | 10 files / 8 MB | 16 files / 12 MB |
| Review surface (H at 8 lines/min + B at 2 artifacts/min) | 93 min | 146 min |

The `ordinary-vertical/evidence` row-set below is prompt 3 section 7's ratified table (captain
ratification 2026-08-20; GD-004) in `E5`'s measure names and numeric formats, recorded by PR-3a; the
slug is slice-specific (prompt 4's table differs on one measure) and every value ratchets downward only.

| Slice class `ordinary-vertical/evidence` - measure | Preferred | Hard |
|---|---:|---:|
| Bucket H, reviewable text lines | 400 | 650 |
| Files touched | 12 | 18 |
| Canonical owners touched | 2 | 3 |
| New public seam symbols | 2 | 4 |
| New database objects | 4 | 8 |
| New direct dependencies, application/runtime allowlist | 0 | 0 |
| New direct dependencies, development/test/build allowlist | 0 | 0 |
| Bucket G, generated-deterministic artifacts | 8 files / 3 MB | 16 files / 8 MB |
| Bucket B, binary and captured-evidence artifacts | 8 files / 6 MB | 14 files / 10 MB |
| Review surface (H at 8 lines/min + B at 2 artifacts/min) | 54 min | 88 min |

The `ordinary-vertical/configuration` row-set below is prompt 4 section 7's ratified table (captain
ratification 2026-08-21; GD-006) in `E5`'s measure names and numeric formats, recorded by PR-4a; the
slug is slice-specific (its seam-symbol values differ from prompt 3's) and every value ratchets
downward only.

| Slice class `ordinary-vertical/configuration` - measure | Preferred | Hard |
|---|---:|---:|
| Bucket H, reviewable text lines | 400 | 650 |
| Files touched | 12 | 18 |
| Canonical owners touched | 2 | 3 |
| New public seam symbols | 4 | 6 |
| New database objects | 4 | 8 |
| New direct dependencies, application/runtime allowlist | 0 | 0 |
| New direct dependencies, development/test/build allowlist | 0 | 0 |
| Bucket G, generated-deterministic artifacts | 8 files / 3 MB | 16 files / 8 MB |
| Bucket B, binary and captured-evidence artifacts | 8 files / 6 MB | 14 files / 10 MB |
| Review surface (H at 8 lines/min + B at 2 artifacts/min) | 54 min | 88 min |

## The two ratified dependency allowlists (ADR-0061 R-7; prompt 2 section 5A)

Both lists are exact-pinned - no range anywhere in any manifest; the lockfile is frozen; the manifest, the
lockfile and this file must carry the same string for every entry; and **every later prompt's dependency
budget counts new additions after this baseline** (prompt 9's addition ceiling is zero). The executing Node
runtime major and the exact `@types/node` major must both be 22 and equal. A package not on a ratified
allowlist requires a new captain ratification (recorded against ADR-0061) before it may appear.

**Application/runtime (eleven):** `next` 16.3.1, `react` 19.2.8, `react-dom` 19.2.8, `pg` 8.23.0,
`zod` 4.4.3, `@opentelemetry/api` 1.9.1, `@opentelemetry/sdk-trace-base` 2.10.0,
`@opentelemetry/sdk-trace-node` 2.10.0, `@opentelemetry/sdk-metrics` 2.10.0,
`@opentelemetry/resources` 2.10.0, `@opentelemetry/semantic-conventions` 1.43.0.

**Development/test/build (thirteen):** `typescript` 6.0.3, `@types/node` 22.20.1, `@types/react` 19.2.18,
`@types/react-dom` 19.2.4, `@types/pg` 8.23.1, `vitest` 4.1.11, `@playwright/test` 1.62.1,
`@axe-core/playwright` 4.13.0, `eslint` 9.39.5, `typescript-eslint` 8.67.0, `prettier` 3.9.6,
`ts-morph` 28.0.0, `tsx` 4.23.12.

## The two exhaustive subject states for `E11` and `E15`

Prompt 1's intentionally manifest-free, build-free tree takes an **honest-empty** path that positively proves
`manifests=0, lockfiles=0, directDependencies=0` (`E11`) and `releaseArtifacts=0, sbomClaims=0` (`E15`) -
never `skipped`, never `not-applicable`. Any appearance of a dependency manifest, lockfile, declared direct
dependency, release artifact or SBOM claim enters the **non-empty** path and requires the ratified baseline,
the complete frozen-lockfile proof, and a real release subject with its matching SBOM whose component set
equals the resolved lockfile's in both directions. Neither rule may report `not-applicable`, and later
prompts with a manifest or release build may not use the honest-empty path.

## The sealed correlation contract (prompt 1 deliverable 3A)

| Kind | Required fields | Where it is used |
|---|---|---|
| `RequestCorrelation` | `requestId` | before a decision exists: prompts 2, 3, 4; prompt 5 before `evaluate` returns; prompt 8 `observe`/`propose`; prompt 9 `readEvidence` |
| `DecisionCorrelation` | `requestId`, `decisionId` | from the moment a decision identity exists: prompt 5 after `evaluate`; prompts 6, 7; prompt 9 `issue`/`readStatus` |
| `ProposalCorrelation` | `requestId`, `proposalId`, `decisionId` only when derived from a decision | prompt 8 `simulate`/`approve`/`activate` |
| `RunCorrelation` | `runId` | non-product evidence and build tooling: prompt 10 `ActivationEvidence` |

`RequestId`, `DecisionId`, `ProposalId` and `RunId` are sealed types constructible only by their factories,
each stamping a domain-separated purpose tag; no identifier may be aliased or relabelled as another. Each
governed-operation registry entry declares the correlation kind its operation requires, the runtime's entry
point is typed on that declared kind, and `E16` compares the exact operation-to-kind map against the
prompt-owned table (a vocabulary-only observation of the four kind names is non-evidence). The runtime fails
closed on a missing required field or a purpose tag that does not match the field it was passed. Prompt 2
emits request correlation and cannot emit a decision identifier; that is the rule working, not a gap.

## Every pinned version the program depends on (a floating tag is not a pin)

| Tool | Pin | Role |
|---|---|---|
| `actions/checkout` | v7.0.1 @ `3d3c42e5aac5ba805825da76410c181273ba90b1` | CI checkout |
| `actions/setup-node` | v7.0.0 @ `820762786026740c76f36085b0efc47a31fe5020`, Node `22.23.1` | CI Node runtime |
| corepack `pnpm` | `10.15.0` | package manager; `E11` frozen install; `E12` audit + licenses |
| `gitleaks/gitleaks-action` | v3.0.0 @ `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` | `E13` secret scan, whole history |
| `semgrep/semgrep` image | 1.174.0 @ `sha256:f1f7b71861c7b28b6e0f661225a2c4f58a484f5d0f182465c6d6b3b22f972ade` | `E14` engine over the repo-owned ruleset `enforcement/semgrep-rules.yml` (ruleset `gen4-sast-rules v1`, versioned in-tree) |
| `anchore/sbom-action` | v0.24.0 @ `e22c389904149dbc22b58101806040fa8d37a610` | `E15` SBOM generation on release subjects |
| `postgres` image | 18.6 @ `sha256:06cad38a5d9f5d24b4d83d86def30795d5e4b757fedbf5281172b576dedcd941` | the development and CI database (prompt 2 onward) |
| `grafana/k6` image | 2.2.0 @ `sha256:9bd01d6941fca969cb61bb57d2da5ee9b385fe2aa8881df3798c196564d6ace6` | prompt 10 deliverable 6 load generator |
| `prom/prometheus` image | v3.14.0 @ `sha256:5ce7540c3c00ef4ab0c9d2c995c6a5b9c421f44b4a115d97a2c7af3b1c21cbb0` | `promtool`, prompt 10 deliverable 15 offline alerting-rule evaluator |
| telemetry-register verifier | program-owned `E16` checker under `enforcement/`, pinned by the release candidate's git SHA, executed by the pinned Node runtime | prompt 10 deliverable 14 |

`NEXT_TELEMETRY_DISABLED=1` is set in the repository's committed `.env` and in the blocking workflow's
environment: no build-time or dev-time network write, and the capability-denied fixture
(`src/tools/deny-net.cjs`) wraps `next build` in CI so a build that reaches any host fails.

`E12` declared severity floor: **moderate**. `E12` license allowlist (closed): MIT, ISC, Apache-2.0,
BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense, CC-BY-4.0, Python-2.0, MPL-2.0,
LGPL-3.0-or-later. The last two are weak copyleft, admitted for unmodified dynamic use because the
ratified baseline transitively carries them (axe-core and lightningcss are MPL-2.0; the libvips
binaries behind Next image optimization are LGPL-3.0-or-later); a dual-licensed package is admitted
only when every arm of its expression is on this list.

## The section 5A bootstrap record (B-6; also recorded in ADR-0061 on `main`)

- Pushed SHA: `71ef1955c3f65710ab5010832a67f27a2aa76cfe`, by
  `git push origin refs/heads/generation-4:refs/heads/generation-4` on 2026-08-20, after the B-3 recheck
  (`git ls-remote --heads origin refs/heads/generation-4`) returned nothing.
- File list from `git show --stat --name-only 71ef1955c3f65710ab5010832a67f27a2aa76cfe`: `README.md` and
  nothing else (`1 file changed, 14 insertions(+)`, `create mode 100644 README.md`).
- Reviewable line count: 14, within the 30-preferred/50-hard bound; bytes byte-identical to the block
  captain-reviewed in ADR-0061 (SHA-256 `a93d9c31b93f28e4336f8a98861708dd5f05b58a9b6452bf32c03bc03bcc44fc`).
- `git rev-list --max-parents=0 generation-4` prints exactly `71ef1955c3f65710ab5010832a67f27a2aa76cfe`
  (one root, no parent); `git merge-base --all generation-4 origin/main` prints nothing and exits 1
  (`origin/main` at `644938fd628e7bdd5842c5b7941b0aba0b1d69ab`).
- Platform-returned protection settings: repository ruleset id `21103072`, `generation-4-protection`,
  `target: branch`, `enforcement: active`, `ref_name.include = ["refs/heads/generation-4"]`; rules
  `deletion`, `non_fast_forward`, `pull_request` with `required_approving_review_count: 0` (the X-1
  amendment), `dismiss_stale_reviews_on_push: false`, `required_reviewers: []`,
  `require_code_owner_review: false`, `require_last_push_approval: false`,
  `required_review_thread_resolution: false`, `require_extra_approval_for_unattributed_changes: true`
  (platform-added default), `allowed_merge_methods: ["merge", "squash", "rebase"]`; `bypass_actors: []`;
  `current_user_can_bypass: never`; created `2026-08-20T13:47:16.998-04:00`.
- Refused-direct-push transcript (B-4.3): `remote: error: GH013: Repository rule violations found for
  refs/heads/generation-4.` / `remote: - Changes must be made through a pull request.` /
  `! [remote rejected] generation-4 -> generation-4 (push declined due to repository rule violations)`.
  The trivial probe commit was reverted; local and remote `generation-4` stand at the pushed root.
