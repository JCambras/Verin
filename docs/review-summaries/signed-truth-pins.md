# signed-truth-pins.json (bucket-G diff summary)

Seventeen SHA-256 digests of the oracle's signed truth at pinned head `644938fd628e7bdd5842c5b7941b0aba0b1d69ab`:
`docs/golden-cases.md` plus the sixteen `fixtures/golden/GC-*.json` signed cases, one digest per blob,
computed by `node enforcement/run.mjs --regenerate=enforcement/signed-truth-pins.json` and byte-compared in
the blocking job. `E10` refuses any oracle byte that no longer matches its pin.
