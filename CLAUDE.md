# Vikalp

An Obsidian plugin for "alternative control" while writing: versions of words, sentences and paragraphs kept in place, ghosting, an Overflow stash, an on-demand linter, and an AI Lab that marks and trims but never writes. Desktop only.

The product and engineering spec is `reference/build-plan.md` (gitignored, local only). Tushar's own notes are `reference/thoughts.md`; never edit that file. Lasting documentation lives in `docs/`.

## Commands

- `npm run dev` builds in watch mode into `dev-vault/.obsidian/plugins/vikalp/` (Hot Reload picks it up).
- `npm run build` typechecks and builds `main.js` (also copied into the dev vault).
- `npm test` runs behaviour tests (Vitest, Node + headless CodeMirror).
- `npm run e2e` launches an isolated Obsidian on `dev-vault/` and runs the end-to-end flows.
- `npm run shots` takes screenshots of the dev vault into `docs/screenshots/`.

Never point anything at Tushar's real vault (`~/Documents/code/mymusings`). The e2e harness uses its own Obsidian profile in `e2e/.profile/`, so a running Obsidian is never touched.

## Layout

```
src/
  core/        pure TypeScript: model, anchoring, text segmentation, rules, AI prompts. No obsidian or CodeMirror imports.
  store/       zustand vanilla stores (per-note mirror, session, settings)
  persistence/ sidecar JSON files per note
  ai/          AI client over pi-ai: OpenRouter, Anthropic, OpenAI or any OpenAI-compatible server
  editor/      CodeMirror 6 state fields, decorations, keymaps
  views/       Preact components and hooks (dumb components)
  plugin/      Obsidian wiring: commands, menus, views, settings
```

Lower layers never import higher ones. Only `plugin/` and `views/*View.ts` import `obsidian`.

## Coding rules

- Modular and easy to read. Presentation and logic stay separate. Components in `views/` are dumb: they get data and callbacks from hooks and never touch CodeMirror, the vault or stores directly.
- Undoable state (spans, versions, ghosts, overflow) lives in CodeMirror state fields so Cmd+Z works across text and metadata. The zustand note store mirrors it for the views. See `docs/architecture.md`.
- Use zustand for state outside the editor. Flux style: state changes only through actions.
- Comments only on public APIs of a module and on hard-to-parse code. Everything else is explained by names. No generic names like `data`, `item`, `temp`, `res`.
- Tests describe behaviour (scenarios a user would recognise), not implementation details. No tests that break when internals are refactored.
- All UI uses Obsidian CSS variables so it works with any theme. No CSS-in-JS. Thin markers, quiet by default, one crossfade is the whole animation budget.
- AI never writes prose into the note. It may only add labelled alternatives, mark text, or propose deleting the user's own words. Nothing AI runs without a click.
- All written content (docs, UI copy, commit messages) is simple, direct and plain. No filler.
- Small, frequent commits, one concern each.
- Review screenshots after UI work (`npm run shots`) in light and dark themes before calling it done.
- Every PR description carries proof. List what was run and its result (tests, e2e, CI), and say plainly what wasn't tested. Attach any useful proof you captured (screenshots, recordings) with `gh pr create/edit --attach` (gh 2.99+): reference the local files in the body, e.g. `![Swap menu, dark](./swap-dark.png)`, and gh uploads them and swaps in the URLs. Never push proof to the repo.

## Learned skills

Repeatable workflows live in `.claude/skills/`.
