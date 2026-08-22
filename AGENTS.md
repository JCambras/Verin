# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Read `CONSTITUTION.md` in full before changes. It defines the generation-4 enforcement contract and
  points to the executable `enforcement/` rules that prevail over prose restatements.
- Treat `origin/main` as a read-only signed oracle. Generation-4 reads oracle bytes through pinned git
  objects and never edits, copies, or silently reinterprets them.
- Regenerate signed decision artifacts only through the commands registered in `package.json`, then
  byte-compare the output with the committed artifact. The signed-case reader takes engine inputs only
  from signed `typedQuantities`; summary prose is not admitted by the input schema and is not an engine
  input.
- Later-unit note: `src/decision/outcome.ts` interprets those typed values after the reader serializes
  them into the string-valued evidence body, using bounded fail-closed patterns. This is outside CD-4c;
  assess a typed evidence body in a later unit.
- Recorded mutation evidence requires the exact check command to pass on a clean committed tree before
  the exact injected bytes are applied and the same command is observed failing.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
