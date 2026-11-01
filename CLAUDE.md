# Vikalp

An Obsidian plugin for "alternative control" while writing: versions of words, sentences and paragraphs kept in place, ghosting, an Overflow stash, an on-demand linter, and an AI Lab that marks and trims but never writes. Desktop only.

The product and engineering spec is `reference/build-plan.md` (gitignored, local only). The maintainer's own notes are `reference/thoughts.md`; never edit that file. Lasting documentation lives in `docs/`; `docs/development.md` has the commands and the release steps.

## Commands

- `npm run dev` builds in watch mode into `dev-vault/.obsidian/plugins/vikalp/` (Hot Reload picks it up).
- `npm run build` typechecks and builds `main.js` (also copied into the dev vault).
- `npm test` runs behaviour tests (Vitest, Node + headless CodeMirror).
- `npm run e2e` launches an isolated Obsidian on `dev-vault/` and runs the end-to-end flows.
- `npm run shots` takes screenshots of the dev vault into `docs/screenshots/`.
- `npm run check` runs the versions check, typecheck, tests and build, the same as CI and the release workflow.
- `npm run lint` runs Obsidian's review lint. It needs the packages CI installs first (see `.github/workflows/ci.yml`); keep it free of errors.

Never point anything at the maintainer's real vault. The e2e harness uses its own Obsidian profile in `e2e/.profile/`, so a running Obsidian is never touched.

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
- Small, frequent commits, one concern each. No co-author trailers.
- This repository is public. Keep personal details (vault names and paths, devices, keys) out of tracked files and out of commit messages.
- Review screenshots after UI work (`npm run shots`) in light and dark themes before calling it done.
- Every PR description carries proof. List what was run and its result (tests, e2e, CI), and say plainly what wasn't tested. Attach any useful proof you captured (screenshots, recordings) with `gh pr create/edit --attach` (gh 2.99+): reference the local files in the body, e.g. `![Swap menu, dark](./swap-dark.png)`, and gh uploads them and swaps in the URLs. Never push proof to the repo.

## Site

- The site is the static `site/` folder. Vercel copies it to `public/` and deploys main to https://vikalp.tushar.ai/ (see `vercel.json`).
- Serve it locally with `python3 -m http.server <port>` inside `site/`.
- When a change touches symbols, spacing or layout, or when asked, check it with `node scripts/check-site-glyphs.mjs` (every character is in the font it is set in) and `node ~/Documents/code/tstack/scripts/site-check/spacing.mjs site` (touching blocks, mismatched key or icon sizes, mouse wording on touch screens). They aren't needed for every change.
- Site PRs merge without waiting for review once the checks pass. The maintainer asked for this.
- The narrated tour videos in `site/media/tour-*` come from the maintainer's own recordings, not the explainers studio. Use them rather than generating a new trailer.

## Learned skills

Repeatable workflows live in `.claude/skills/`.
