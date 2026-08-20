# Verin

This branch, `generation-4`, is the fourth-generation rebuild of Verin. It is not the default branch
and it is not the running system. The `main` branch is the read-only oracle: it holds the current
system, its history, its signed truth, and its audit evidence, and it is never edited to agree with
anything on this branch. `CONSTITUTION.md`, which states the rules every change to this branch obeys,
arrives in the first pull request against this root (PR-1a); until it lands, this file is the only
content here.

This root commit was created by a single authorized push, because a root commit has no parent for a
pull request to review against. Branch protection requiring a reviewed pull request is enabled on this
branch immediately after that push. Every commit after this one arrives through a pull request.

The product and this repository remain named Verin.
