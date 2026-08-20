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
