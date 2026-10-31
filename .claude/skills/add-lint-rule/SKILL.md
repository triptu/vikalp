---
name: add-lint-rule
description: Add or tune a built-in Vikalp lint rule, with tests. Use when a rule is noisy, missing a pattern, or a new rule is wanted.
---

# Add or tune a lint rule

1. Read `docs/rules.md` for the YAML format and engines.
2. Built-ins live in `src/core/rules/builtin.ts`; word lists in `src/core/rules/data/`. Engines are in `src/core/rules/engines/`.
3. Add rows to the rule's table in `tests/core/rules.test.ts`: sentences that must be flagged and plain essay sentences that must not. Precision matters more than recall; the maintainer dislikes false positives.
4. `npx vitest run tests/core/rules.test.ts`. The "clean essay" test guards against noise; keep it at its current hit count or lower.
5. Built-ins are written to the user's rules folder only on first run. Existing users get rule changes only for rules they never edited, after "Reload rules". Mention this in the commit if behaviour changes.
6. Judgment checks (`judgment:` or `engine: classifier`) are yes/no questions about the unit text. Phrase them so plain writing gets a clear "no".
