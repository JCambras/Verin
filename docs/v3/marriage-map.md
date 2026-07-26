# Verin Architecture v3 - Marriage Map

Date: 2026-07-26 (updated with core contracts + prompt sequence + demo contract v1)
Sources: ~/Downloads/verin-architecture-v3.md, ~/Downloads/verin-core-contracts.ts, ~/Downloads/verin-prompt-sequence-v3.md, ~/Downloads/verin-demo-contract-v1.md
Baseline: Verin repo at PR #11 (post-foundation, pre-Wave-1); charter + 22 ADRs + D-001..D-030; queued 7-prompt demo chain (verin-p2..p7).
Purpose: how v3 marries the existing build - what stands, what changes, what conflicts, how the queued work remaps. Captain directive: improve direction, not net-new.

CAPTAIN SALESFORCE DIRECTIVE (2026-07-26, ruling): "Salesforce MCP is going to have to wait, let's do everything else we can without that." Prompt 27 (sandbox archaeology + real adapter) and prompt 28's real-path assembly are DEFERRED with un-defer trigger = sandbox access granted. All other waves proceed on in-memory fakes per orchestrator rule 6. Phase 1 completion stays honestly gated (never declared complete on fakes); C4's charter amendment becomes an explicit deferral ADR with the named trigger, matching the charter's own deferral idiom. Demo-contract v1 §8 completion test items requiring real SF are marked deferred-pending-sandbox.

CAPTAIN DESIGN DIRECTIVE (2026-07-26, ruling): the captain HATES the v3 demo look. The demo's UI/UX feel is the ESTABLISHED Verin design system - Meridian's feel + Iris's discipline as already built and chartered: OKLCH slate tokens, Geist, "Verin." wordmark, calm one-decision-at-a-time, WhyBubble, FreshValue, freshness-as-opacity, StatusBadge/ProgressSteps/StepInfoCard/EmptyState, WCAG 2.2 AA, reduced-motion. The external demo-design-language.md is NOT adopted; instead docs/demo-design-language.md gets AUTHORED from the existing presentation tier, keeping v3's UX SEMANTICS (Decision Spine as persistent orientation, disposition treatments - blocked shows resolving affordances, prohibited shows zero affordances, approval-invalidation moment) re-expressed in the established visual language.

## 1. What v3 is

- Repositions Verin from "practice-intelligence platform an RIA runs its book on (house CRM as SoR)" to **the governed decision and execution layer above CRM, meeting tools, and custodians**. External systems supply evidence, provide staff surfaces, perform actions; Verin decides, explains, routes authority, coordinates execution, records proof.
- New decision core: the 15-stage spine (shape -> bind -> evidence -> validate -> evaluate -> disposition -> explain -> authority -> approve -> revalidate -> reserve -> execute -> reconcile -> verify), DecisionRecord + DecisionInputBundle (byte-identical replay), typed policy AST with closed vocabularies + deterministic evaluator, precedence (firm vs household, order-independent), authority stages w/ quorum/expiry/escalation, typed append-only event ledger, reservations/conflict keys, zero-PII LLM boundary (Tokenized<T> factory-only).
- New demo contract: 7-minute "$75k for the Smiths by Aug 15" journey; real Salesforce sandbox execution w/ idempotency; honest status labels (submitted != settled); one NL policy-authoring moment ("preserve 12 months of planned withdrawals in cash") through draft AST -> simulate -> approve -> activate -> changed rerun; Firm A vs Firm B zero-code-change comparison; measured known-defect detection rate on a provenance-split replay corpus (real AdviceOne defect history preferred).
- 12 non-negotiables (v3 §3) + 30 phase-gated invariants (v3 §17) + module map (v3 §16) + known-risks register (v3 §20).
- Companion artifacts: verin-core-contracts.ts (the full §5/§12/§8 vocabulary as framework-free TS, to be Zod-wrapped at every boundary) and the 30-prompt build sequence (waves 0/A-I with gates; demo-first, architecture-enforced, Salesforce-integration-gated).

## 2. What stands (built assets v3 lands on)

| v3 requirement | Existing asset | Status |
|---|---|---|
| Phase-gated invariants, never fake green (§17) | 22 adversarially-proven fitness fences, proof-log, detection-not-verification meta-fence, charter-map.json + charter-drift fence | Methodology identical; v3 invariants become new fences. Prompt 4's active-pass/active-fail/not-yet-active runner is a genuine upgrade to the all-active fence suite |
| Tenant scoping everywhere (inv. 2, §15.2) | org_id on every table + org-id-required fence + per-org audit chains | Built (vocabulary note: v3 says firmId; see C13) |
| Append-only ledger (inv. 5, §12) | Hash-chained audit_log + DB triggers + outbox + anchor + CI chain-verify | Substrate built; typed LedgerEntry union (14 event types w/ correlation/causation), projections, serializer versioning layer on |
| Idempotent external writes (inv. 20, §13) | auditedWrite + crm_write_cache PK(org,key) + client-minted clientRequestId + edited-replay CONFLICT + exactly-once fence | Built; add reservations/conflict keys/revalidation (prompt 23) + three-port conformance suite (prompt 24) |
| Human gates (approve stage) | FlowStep suspend/await-external/resume, fenced, e2e-proven; roadmap Wave 2 already planned approval-gate step kind + step-up auth | Substrate built; approval templates/instances, quorum, expiry, escalation (prompt 18) are the new layer |
| Zero-PII boundary (§15.1) | contracts/pii.ts, scrub.ts, no-pii-in-audit-store fence, opaque userId, pino redaction | Built for audit/log boundary; Tokenized<T> factory-only + llm/ reachability fence (prompt 6) is the extension; LLM surface absent (deliberately), clean ground |
| Evidence w/ freshness+provenance (§5.2) | RecordProvenance {source, asOf, confidence} on all 9 entities, FreshValue freshness-as-opacity, provenance fences, DerivedProvenance + demonstration watermark (ADR-0022) | Field-level provenance built; immutable content-hashed EvidenceSnapshotRef + DecisionInputBundle (prompts 14-15) are new |
| Honest status labeling (§14) | Charter #3 no-unlabeled-synthetic + canFeedComplianceDecision refusal + watermarking doctrine | Same soul; extend to execution-status honesty (ObservedStatus taxonomy, prompt 26) |
| Explanation from evaluation trace (inv. 12) | WhyBubble doctrine (charter #10) + presentation tier (WhyBubble, FreshValue, StatusBadge, ProgressSteps, StepInfoCard) | Doctrine + visual grammar built; ExplanationNode trace plumbing new (prompt 16); WhyBubble becomes the renderer of explanation nodes |
| Actor attribution (§15.3) | Real auth (scrypt, sessions w/ renewal+rotation), server-side RBAC at port, audited login/logout, WriteActor | Built; per-action authz hooks (approve/override/execute/audit-export) extend it |
| Zod parse at boundaries, forward-only migrations, Vitest, property tests (§18) | Zod 4 everywhere, versioned append-only migrations (D-029), Vitest 4 non-UTC, fences | Built |
| Demo-vs-real integrity (§20 risk 9) | dataClass live/demo plan, clean-slate purge, prod-boot zero-demo-rows, watermark end-to-end | Chartered (POC strategy), partially built; prompt 3's dev-only fake badges = the same labeling doctrine applied to fakes |
| Firm A/B (inv. 26) | Multi-tenancy org_id day one; two firms = two orgs | Plumbing built; per-firm policy layer is the new part |
| Conversation as control plane not product (§2.2 intent surface) | PRODUCT-DIRECTION "the conversation controls the software; the conversation is not the software" | Identical doctrine, near-verbatim |
| Household workspace (§2.2) | PRODUCT-DIRECTION §5 household detail as center of work; deep-review #1 (skeleton output invisible) | Specified, not yet built; prompt 3 builds it |
| Adversarial audit (prompt 30) | Persona board (Vale/Wren/Sable), fresh-context rules, docs/reviews tradition | Direct fit; prompt 30 is a Vale-class audit with a defined report shape |

## 3. What v3 genuinely adds (net-new subsystems)

1. Policy AST + deterministic evaluator + load-time effect-conflict validation (closed vocabularies).
2. Decision core: DecisionRecord, DecisionInputBundle, disposition (proceed/blocked/prohibited), precedence engine, primitives (<15 target, falsification-tested, cross-domain matrix).
3. Authority: approval templates (relative expiry) vs instances (absolute expiry, deterministic instantiation), quorum, escalation, approval bound to decisionHash+inputBundleHash, invalidation on material change.
4. Typed event ledger (14 LedgerEntry types w/ occurredAt/recordedAt/correlation/causation) + byte-identical replay (canonical serializer, engine-version pinning).
5. Reservations, conflict keys, pre-execution revalidation (reference failure: two simultaneous $75k requests individually valid, jointly overcommitted).
6. LLM surface: masked intent shaping + NL policy drafting (OpenAI-compatible adapter); Tokenized<T> factory + fences. Three-stage resolution: LLM shapes masked, deterministic binding on real records, human disambiguation outside the model.
7. Salesforce sandbox adapter behind three separately-typed ports (EvidenceSource/ExecutionTarget/StatusSource) + conformance suite shared w/ in-memory fakes (prompt 24 before 27).
8. Replay corpus + measured defect-detection metric (provenance-split real/synthetic reporting; corpus generator prompt 11).
9. Verification/reconciler: status polling + human-channel ingestion, Submitted/InFlight/Completed/Rejected/NIGO/Unknown, stuck-state events, ExceptionDecisionRequested derivation.
10. Demo contract + golden cases as signed product truth (prompts 1-2: docs/demo-contract.md, config/demo/scenarios.yaml, >=12 golden cases w/ human signoff field).
11. Execution planner: dependency-aware steps (dependsOn), compensating actions, partial-success representation.

## 4. Conflicts to raise (v3's own rule: raise, never silently resolve)

| # | Conflict | Existing record | v3 says | Recommendation |
|---|---|---|---|---|
| C1 | Store | D-001 captain decision: PostgreSQL, explicitly rejected libSQL/Turso (RLS, append-only triggers, PITR); PGlite dev/CI + managed PG prod; audit chain leans on PG triggers | SQLite WAL (arch §18, prompt 4) | Keep Postgres. Strictly stronger for the append-only/ledger story. Record deviation by ADR |
| C2 | Web stack | Next.js 16 App Router + Server Actions, shipped + fenced; e2e against real build | Fastify API + React/Vite UI (arch §18, prompts 3-4) | Keep Next.js. v3's real requirement is "transport carries no domain logic," already fenced. Record by ADR |
| C3 | Import tooling | ts-morph AST fences (dependency-rule incl. dynamic imports) | dependency-cruiser / eslint-plugin-boundaries | Keep ts-morph fences (stronger + proven); satisfy intent |
| C4 | Salesforce timing | Charter SoR strategy "decided, do not reopen": house CRM SoR, ZERO SF adapter code now; roadmap Wave 3 | Real SF sandbox execution path required for Phase 1 completion (prompt 27 hard stop) | Genuine reversal; captain call. Mechanically an acceleration (sf-mapping.ts groundwork exists; SF stays a removable adapter; fakes carry early waves). Needs charter amendment ADR. Sandbox access is a captain-level external dependency |
| C5 | Money-movement timing | POC strategy directive: Wave 1 = read flows, money Wave 2 | Money movement IS the Phase 1 vertical | Captain effectively already reversed this in the 7-prompt plan (P6); v3 confirms. Ratify explicitly |
| C6 | Module map | Four-layer (contracts <- domain <- infrastructure <- app), fenced | §16 flat module map; prompt 4 "create all core module directories from §16" | Not a conflict of principle: v3 modules become domain/ (+infrastructure/) subsystems inside the four layers; v3 dependency rules become new fences (decision/ never imports llm/, no module imports config/, etc.) |
| C7 | Product identity docs | PRODUCT-DIRECTION.md (PR #10): "Iris on the surface," catalog-of-workflows framing; house CRM as SoR product story | Decision layer above the CRM; "not a workflow builder"; §2.2 screens; Decision Spine top rail | Large overlap survives (household-centered, conversation-as-control-plane, WhyBubble, examiner-ready). PRODUCT-DIRECTION needs a v2 revision; role-aware homes / meeting-prep / compliance-scan become later-phase surfaces |
| C8 | Demo scenario | 6-min Cascade Wealth Partners cast, compliance-scan centerpiece | 7-min Smiths $75k journey + Firm A/B + measured detection rate; prompt 13 wants MULTIPLE Smith households for ambiguity testing | Reconcilable: cast world remains the believable book/corpus; the Smiths join it as the money-movement marquee; compliance beats survive as evidence/conflict + examiner-record views. Captain call on final cast |
| C9 | Two constitutions risk | CHARTER.md amended only by ADR + charter-drift fence; CLAUDE.md symlinked to AGENTS.md | v3 "ground truth, supersedes prior"; prompt 4 "copy the architecture non-negotiables into CLAUDE.md" | Adopt v3 INTO the charter machinery via amendment ADR(s) + charter-map extension (charter 16 <-> v3 §3 <-> v3 §17 <-> fences). Never two rival ground truths. Prompt 4's arch-version checksum idea is good - keep it, pointed at the ratified in-repo doc |
| C10 | Workflow engine positioning | ADR-0010 generic engine + declarative flows is the product shape | "Not a workflow builder"; domains expressible as pure configuration (prompt 10) | Engine survives as execution substrate; account-opening flow def migrates to config/domains/account-opening.yaml (prompt 10 names it explicitly); no domain-named core modules |
| C11 | AdviceOne | DO-NOT-PORT #6 bans hardcoded firm identity in code | Replay corpus from AdviceOne real defect history | Compatible: corpus is scrubbed DATA with provenance labels, never code identity. PII scrub + provenance-split labeling at corpus intake |
| C12 | Greenfield assumption | Shipped repo: foundation + 11 PRs, fences, CI, auth, audit chain, e2e, load gate | Prompt sequence assumes empty repo (prompt 4 scaffolds; prompt 3 builds UI from scratch) | Re-baseline the sequence onto the existing repo (section 6). Prompts 4/6/7/24 are partially done; prompt 3 uses the existing presentation tier + Next.js; nothing existing is discarded |
| C13 | Tenant vocabulary | org_id everywhere (schema, fences, audit chains) | FirmId brand throughout contracts | Map FirmId ≡ org_id: keep org_id at the store layer (fences unchanged), brand as FirmId in domain contracts. One-line ADR note; do not rename the substrate |
| C14 | Fake-backed demo-first UI | Charter #5 nothing built-but-not-shipped; DO-NOT-PORT #3 bans setTimeout theater | Wave 0 clickable skeleton on static/fake data BEFORE the engine | Reconcilable and healthy: fakes carry a visible dev-only provenance badge removable only when the real path lands (prompt 3) - that IS charter #3's labeling doctrine applied to fakes, and orchestrator rule 6 forbids declaring done on fakes. Ratify via ADR so the walking-skeleton wave doesn't read as a charter violation |
| C15 | Missing referenced doc | - | docs/demo-design-language.md required before ANY UI work (prompts 3, 29, standing rules); defines tokens, Decision Spine rail, ledger-register, disposition treatments, 3 motion moments | Not yet provided. Block UI prompts until the captain drops it; existing OKLCH/Geist token system is presumably its input |

## 5. Core-contracts file notes (verin-core-contracts.ts)

- Framework-free, Zod-wrapped-at-boundaries: matches the existing contracts/ layer discipline exactly (imports nothing project-local). Lands as src/contracts/decision-core (or similar) beside result.ts/errors.ts/roles.ts.
- Style merge points: branded IDs (Brand<T,Tag>) are new to the repo (existing uses plain string unions e.g. roles.ts 5-role union -> RoleId brand); Result<T,E> stays the error idiom around these types; Timestamp brand must respect the ISO-string-both-ways store discipline (OID 1184 parser) - it already models timestamps as strings, good fit.
- Elaborations beyond the arch doc worth noting: LedgerBase occurredAt vs recordedAt + correlationId/causationId; ExecutionStep.dependsOn (dependency-aware plans); ExecutionReceipt outcome incl. duplicate_suppressed; RevaluationCondition kinds (evidence/policy/instruction/approval-expiry/reservation-expiry/status/deadline); BlockedDecision comment: resolving evidence derived from blockers, never stored twice; Tokenized<T> normative comment: sole factory in scrubber module + lint/CI rule + import-reachability test.
- ApprovalStageTemplate (expiresAfter: Duration) vs ApprovalStage (expiresAt: Timestamp) - template/instance split is explicit; replay uses recorded instances.
- Existing Principal/WriteActor maps to ActorRef/SystemActorRef; existing RecordProvenance does NOT disappear - it remains the field-level label on operational rows while EvidenceSnapshotRef is the immutable decision-input entity.

## 6. 30-prompt sequence re-baselined onto the existing repo

Wave gates unchanged. Per-prompt status against the shipped codebase:

| Prompt | Status vs repo | Re-baseline note |
|---|---|---|
| 1 demo contract | NEW | Straight port (docs/demo-contract.md + config/demo/scenarios.yaml) |
| 2 golden cases | NEW | Straight port; human-signoff field = captain |
| 3 walking skeleton UI | REWRITE | Next.js App Router + existing presentation tier, NOT React/Vite; BLOCKED on demo-design-language.md (C15); dev-only fake badges per C14 ADR |
| 4 scaffold + CI | ~70% DONE | Keep repo/CI/fences. NEW: phase-gated invariant runner (active-pass/active-fail/not-yet-active), PR template (phase + active invariants + demo behavior + contradictions), arch-version checksum. DROP: Fastify/SQLite/Vite/dep-cruiser (C1-C3) |
| 5 core type system | NEW | Land verin-core-contracts.ts + Zod wrappers + illegal-state tests; style merge per §5 above |
| 6 security boundaries | ~50% DONE | Existing: org-id fence, PII scrub, RBAC, no-secret-fallback. NEW: Tokenized factory + llm/ reachability fence + per-action authz hooks |
| 7 ledger + replay storage | ~40% DONE | Build typed LedgerEntry + projections + serializer versioning ON the existing hash-chain/outbox/trigger substrate; decide extend-audit_log vs sibling ledger tables sharing chain mechanics |
| 8 primitives | NEW | <15, falsification tests, cross-domain matrix |
| 9 policy AST + interpreter | NEW | Incl. load-time effect-conflict rejection property tests |
| 10 domain config schema | NEW | Absorbs ADR-0010 flows: account-opening flow def -> config/domains/account-opening.yaml; engine becomes platform module |
| 11 corpus + fixtures | MERGE | Fold demo-design-s5 cast + dataClass/D-005 populated-world plan into the deterministic generator; provenance-split labeling |
| 12 intake pipeline | NEW | Human + system triggers converge on Intent |
| 13 masked shaping + binding | NEW | First LLM surface; multiple-Smiths ambiguity tests |
| 14 evidence snapshots + ports | NEW | House CRM becomes the first in-memory EvidenceSource (household data, bank instructions, account values, planned withdrawals, pending actions) |
| 15 validation + input bundle | NEW | validate distinct from evaluate; bundle hashing |
| 16 evaluator + explanation | NEW | Pure function, no clock/network; WhyBubble renders ExplanationNodes |
| 17 precedence | NEW | Order-independence property tests (shuffled seeds) |
| 18 authority | NEW | On the suspend/resume substrate; ref cases: Firm A 2 distinct ops approvers >$25k, Firm B >$100k, requester exclusion, bank-change specialist review |
| 19 byte-identical replay | NEW | Canonical serialization; adversarial break attempts |
| 20 policy lifecycle + simulation | NEW | draft->simulated->in_review->approved->active->superseded |
| 21 household instructions | NEW | Independently versioned; never hidden policy patches |
| 22 NL policy path | NEW | Absorbs old P5 verbatim intent; "12 months of planned withdrawals in cash" |
| 23 reservations + revalidation | NEW | Two-simultaneous-$75k reference failure |
| 24 ports + conformance + idempotency | ~30% DONE | auditedWrite/idempotency fence exist; NEW: three-port split, conformance suite, fakes |
| 25 execution planner + exceptions | NEW | Extends engine; ExceptionDecisionRequested only when judgment needed |
| 26 verification reconciler | NEW | ObservedStatus taxonomy; delayed NIGO; stuck states |
| 27 SF archaeology + real adapter | NEW + GATED | Requires sandbox access (captain dependency) + C4 charter amendment; hard stop if unavailable |
| 28 assemble vertical | NEW | Zero new money-movement core module; Firm B config-only |
| 29 measurement + choreography | NEW | Absorbs old P7; BLOCKED on demo-design-language.md; measured metrics w/ provenance split |
| 30 adversarial audit | NEW | Run through the persona board (Vale-class); defined report shape |

Existing assets the sequence must NOT displace (extend ci.yml, never replace): axe/a11y gates, load gate (write-path SLO), SOC 2 controls matrix, backup-restore drill, session/auth stack, audit-chain CI verify, OTel, knip, secret-scan/SAST/license gates, non-UTC test discipline.

Old p2-p7 chain: superseded by this sequence once the captain ratifies (p2 ~ prompts 1-2+ratification ADRs; p4 ~ prompt 3; p5 ~ prompt 22; p6 ~ prompts 28-29; p7 ~ prompt 29). Do not annotate/restructure backlog until captain's word.

## 7. Recommended posture (pending captain's word)

Adopt v3's thesis, spine, contracts, invariants, and the 30-prompt sequence as the direction; implement inside the existing chartered machinery (four layers, fences, ADRs, Postgres, Next.js) rather than v3's incidental stack prescriptions; ratify via charter amendment so there is exactly one constitution; re-baseline the sequence per section 6. A "prompt 0" ratification step should precede Wave 0: charter amendment ADRs (C4, C5, C14), deviation ADRs (C1-C3, C13), charter-map extension to the 30 invariants, phase-gated invariant runner, arch-version check.

## 8. Open questions for the captain

- demo-design-language.md - drop when ready; UI prompts (3, 29) are blocked on it.
- Salesforce sandbox: whose org, provisioning path, managed-package scope, invocable Apex surface (prompt 27 hard-gates Phase 1 completion on it).
- Corpus access: AdviceOne defect-history export + scrub pipeline.
- Firm A/Firm B: Cascade Wealth Partners as Firm A + a second seeded org as Firm B? Cast reconciliation (C8): Smiths join the existing cast?
- Charter ratification: extend the 16 non-negotiables via ADR (recommended) - the 16 cover ops/security axes (SOC 2, DR, supply chain, a11y, budgets) v3 doesn't; v3's 12+30 cover the decision core the 16 don't.
- Old p2-p7 backlog chain: annotate superseded once ratified.
