# Generation-4 enforcement proof log

One entry per rule (`M-E1..M-E16`) plus the named vacuity entries (`M-V1..M-V3`): each records the injected
violation, the exact failure output, and the revert. A rule with no entry is an unproven rule; the blocking
job fails unless the mapping is total in both directions. Mutations run in disposable local clones against
real repository state; no mutation writes to any remote.

## M-E1 (rule E1)
- Injected: in a disposable clone of this PR's tree with the real `origin/main` fetched,
  `git merge origin/main --allow-unrelated-histories -X ours`, then `node enforcement/run.mjs` under a
  push-context environment.
- Observed (exit 1): `E1 FAIL 644938fd628e7bdd5842c5b7941b0aba0b1d69ab - generation-4 shares history with
  origin/main: merge-base 644938fd628e7bdd5842c5b7941b0aba0b1d69ab`.
- Reverted: `git reset --hard HEAD^`; clone discarded; the shipped tree never carried the merge.

## M-E2 (rule E2)
- Subject: the real platform event payload of this stack's own pull request (PR-1a), captured from the
  blocking job's `cat "$GITHUB_EVENT_PATH"` step of that PR's first CI run. Why this subject: the
  platform-supplied base ref is the entire input; a genuinely mistargeted PR would be the violation itself,
  and creating a second repository is a network write section 3 forbids. This limitation is recorded here
  rather than smoothed.
- Captured: run 32402570676's payload for PR #46 - event `pull_request`, `base.ref: generation-4`,
  `base.sha: 71ef1955c3f65710ab5010832a67f27a2aa76cfe`, `head.ref: fm/gen4-pr-1a`.
- Arm 1, the real payload unaltered, through the shipped stack: `E2 PASS`.
- Arm 2, the same real payload with `base.ref` set to `main` (exit 1): `E2 FAIL base.ref - this pull
  request targets 'main', not generation-4`.
- Arm 3, the same real payload with the base ref deleted (exit 1): `E2 FAIL base.ref - pull_request
  payload carries no base ref; a missing field is not agreement; failing closed`.
- Reverted: the altered copies were temporary files; the shipped rule and the captured payload are unchanged.

## M-E3 (rule E3)
- Subject: the real API answer for this repository (`GET /repos/JCambras/Verin`, `default_branch: main`).
  The default branch is never actually changed to test this rule: DC-6 reserves that to the captain.
- Arm 1, real answer through the shipped stack: `E3 PASS`.
- Arm 2, the same real answer with the field set to `generation-4` (exit 1): `E3 FAIL default-branch - the
  repository default branch is 'generation-4', expected 'main'`.
- Arm 3, no credential, so the query genuinely fails (exit 1): `E3 FAIL default-branch - the repository
  default branch could not be read (no credential (GITHUB_TOKEN unset); refusing an unauthenticated read);
  an unanswered question is never treated as 'main'; failing closed`.
- Reverted: altered copy was a temporary file; nothing shipped changed.

## M-E4 (rule E4)
- Injected: a pull-request payload declaring two seam ids, through the shipped stack (exit 1):
  `E4 FAIL pr-body - more than one declared seam id: Gen4EnforcementContract, AccessContext`.
- Injected: a declared id not in `CONSTITUTION.md`'s closed roadmap list (exit 1): `E4 FAIL pr-body -
  declared seam id 'NotARatifiedSeam' is not in CONSTITUTION.md's closed roadmap list`.
- Reverted: payloads were temporary files; the closed list in `CONSTITUTION.md` is unchanged.

## M-E5 (rule E5)
All eight subcases ran in a disposable clone as simulated pull requests against the shipped stack, each
injected on a detached head and discarded. Exact failure lines (exit 1 in every failing arm):
1. Mixed overflow - a qualifying 40-line registered generated artifact plus a 401-line hand file:
   `E5 FAIL Bucket H, reviewable text lines - ... measured 415 exceeds hard ceiling 400` while printing
   `gen.txt - bucket G, added 40 lines`, proving the generated file neither counts toward nor conceals H.
2. A hand-authored runbook alone: `... measured 401 exceeds hard ceiling 400`, with
   `docs/runbook-restore.md - bucket H, added 401 lines`.
3. A hand-authored fixture, snapshot, and evidence manifest, one at a time: each
   `E5 FAIL Bucket H ... measured 401 exceeds hard ceiling 400`.
4. Generated-only overflow: 17 registered reproducing artifacts -> `Bucket G ... 17 artifacts exceeds hard
   ceiling 16`; separately two 4.5 MB artifacts -> `9437186 gross bytes exceeds hard ceiling 8 MB`.
5. A generated text artifact hand-edited by one byte: `bucket-G artifact failed its qualification
   (reproduced=false ...) reclassified to H`, then `measured 514 exceeds hard ceiling 400` counting its 500
   lines in H - both failures in one run.
6. A generated binary with broken regeneration: reclassified to B, never a line count; nine crossed
   `9 artifacts exceeds hard ceiling 8`, and a 7 MB one crossed `7340048 gross bytes exceeds hard ceiling
   6 MB` with `img-big.bin - bucket B, added 0 lines, 7340048 bytes`.
7. A hand-authored font with a gallery row: `E5 PASS` (enters B immediately); removing its gallery row:
   `bucket-B artifact has no review-gallery row (path + SHA-256)`; nine hand binaries and a 7 MB capture
   then crossed the B count and byte ceilings for the intended reasons.
8. Binary-only: nine gallery-listed screenshots -> B count failure; two 3.5 MB screenshots -> B byte
   failure; two small screenshots with the gallery deleted ->
   `bucket-B artifact has no review-gallery row` for each, under both ceilings.
- Reverted: every mutation was a detached-head commit in the clone; the branch never moved.

## M-E6 (rule E6)
- Injected: `enforcement/orphan.mjs` exporting `orphanHelper` with no caller (exit 1):
  `E6 FAIL enforcement/orphan.mjs - new exported symbol 'orphanHelper' has no non-test caller reachable
  from a live entry path`.
- Then a test-only caller (`orphan.test.mjs`): the same failure - a test caller is not reachability.
- Then wired into the live runner entry: `E6 PASS`. Reverted: detached-head commits, discarded.

## M-E7 (rule E7)
- Injected: a real surface `src/ui/balance-card.tsx` rendering `{account.balance}` bare (exit 1):
  `E7 FAIL src/ui/balance-card.tsx - metric-class render without provenance (no source/asOf):
  <span>{account.balance}</span>` - and the plain `{household.name}` on the same surface passed untouched,
  proving the rule does not fire on every render. Reverted.

## M-E8 (rule E8)
- Injected: `["E99", () => []]` - an always-PASS check with no companion (exit 1): `E8 FAIL E99 - new
  PASS-emitting check E99 ships with no companion mutation entry added to docs/proof-log.md in this PR`.
- Then an entry with an Injected line but no recorded failure: `E8 FAIL E99 - companion entry for E99
  records no observed failure; a companion that never failed proves nothing`. Reverted.

## M-E9 (rule E9)
- Injected: `src/sync/push.ts` fetching a literal host (exit 1): `E9 FAIL src/sync/push.ts:2 - outbound
  network host 'api.salesforce.example.com' is not on the allowlist (which is empty until slice 9)`.
- Then the host assembled from `process.env`: `E9 FAIL src/sync/push.ts:3 - outbound call with an
  unresolved destination; a host the rule cannot read is a host it refuses`. Reverted.

## M-E10 (rule E10)
- Injected: in the clone, one byte of `fixtures/golden/GC-01-firm-a-happy-path.json` changed on a commit
  the oracle ref was pointed at (exit 1, before any parse): `E10 FAIL fixtures/golden/GC-01-...json -
  signed truth changed before parsing: expected sha256 9144263da1c06055c4203248cd6664b3c7666ecb1d4e7b
  9ef69c5abec88bc4ac, read 6fd9f136800692a09288d750500b1caf604d3d5a85577200731c3b9e9f679d75; refusing to
  continue` - both digests printed, no downstream step ran. Reverted: the clone's oracle ref re-fetched.

## M-V1 (rule E5)
- Injected: a simulated pull request whose base and head are the same commit, so the changed-path list is
  empty (exit 1): `E5 FAIL diff - E5 saw zero changed paths; a check that sees nothing must never report
  clean`. Reverted. A check that sees nothing must never report clean.
