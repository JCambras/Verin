# signed-truth-pins.json (bucket-G diff summary)

The oracle pin registry after the pin move (PR-5c-ii): `oracleHead` moves from 644938fd to the
captain's signing commit 5542c999 - the ONE amendment PR of the 2026-08-21 signature sitting - and
all seventeen SHA-256 pins regenerate from that commit's bytes via the registered command
(`node enforcement/run.mjs --regenerate=enforcement/signed-truth-pins.json`), byte-identically.
Every signed-case read still verifies its blob against these pins BEFORE parsing and refuses
naming both digests. This commit is what clears the deliberate E10-red window that opened when the
amendment merged on main; the signed bytes themselves were never touched from generation-4.
