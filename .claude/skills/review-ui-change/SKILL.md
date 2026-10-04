---
name: review-ui-change
description: Adversarial review of a Vikalp UI change or phase. Use before committing a visible feature or calling a phase done.
---

# Review a UI change

1. Run `npm test`, `npm run build`, and the relevant `npm run e2e` flow.
2. Take screenshots (see the screenshot-dev-vault skill) in light and dark.
3. Start two read-only subagents in parallel:
   - code: bugs (undo, range mapping, async load/save races, leaks on unload), layering rules in CLAUDE.md, AI principle violations, per-keystroke work;
   - product/design: compare with `reference/build-plan.md` Part 1 and the screenshots; list gaps and anything sloppy or un-Obsidian-like.
   Tell them not to edit files or launch Obsidian.
4. Verify each finding before fixing it. Fix, re-run tests and screenshots, commit.
