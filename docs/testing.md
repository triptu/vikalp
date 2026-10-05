# Testing

Tests describe behaviour a writer would recognise. They should survive refactors.

## Behaviour tests

`npm test` runs Vitest in Node.

- `tests/core/` covers the pure code: anchoring, sentence splitting, a/an, tidy deletions, quote placement, trim targets, and a table of good and bad sentences for every built-in lint rule.
- `tests/editor/` runs editor actions against a headless CodeMirror state with the real fields and history: creating spans, cycling, undo and redo, nesting, ghosts and Overflow.

## End-to-end

`npm run e2e` builds nothing; run `npm run build` first. It then:

1. copies `dev-vault/` to `e2e/.artifacts/vault/` so the checked-in notes never change,
2. launches the installed Obsidian with its own profile in `e2e/.profile/` (a running Obsidian and your real vault are untouched),
3. connects over the Chrome DevTools protocol with Playwright and runs the flows in `e2e/run.mjs`.

The flows follow the spec: alternatives surviving a restart, ghosting and copy clean, stashing and dragging back, linting the LinkedIn draft, re-anchoring after an outside edit, span notes and read-through.

Run one flow by name: `npm run e2e -- ghost`.

The ChatGPT flow does not need an account. It starts a sign-in, checks the page it opens and the local reply listener, then sends a bad reply and checks nothing is stored. Signing in for real is a manual check.

The linter flow calls Jev for real, so it needs `openRouterApiKey` in `dev-vault/.obsidian/plugins/vikalp/data.json` (that folder is gitignored). Without a key the judgment rules are skipped and that flow may fail.

## Screenshots

`npm run shots` drives the dev vault through the main features in light and dark themes and writes PNGs to `docs/screenshots/`. Look at them after any UI change. Then `python3 e2e/crop-guide.py` refreshes the cropped images in `docs/screenshots/guide/` that the user guide shows.
