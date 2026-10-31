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

Flows are grouped so a whole group shares one Obsidian and one scratch vault. The first group writes (alternatives, ghosts, Overflow, unit tabs, hotkeys, span notes, two panes), edits the file outside Obsidian, restarts once, and checks that everything was saved and re-attached. The second group lints the LinkedIn draft, adds a rule in settings, edits while judgment rules run, and finds spots with AI. The third switches to Ollama, pointed at a stand-in server (`tests/support/mockModelServer.ts`) so no real Ollama is needed, asks it for versions, and switches back to OpenRouter. Flows in a group run in order and build on each other, so choose new words when adding one.

Run one group by naming any of its flows: `npm run e2e -- ghost`.

AI answers come from `e2e/ai-recordings.json`, so most runs never wait on the model. A request with no recording (new prompt, changed note) goes to the model once and its answer is saved; commit the file with it. `npm run e2e -- --live` asks the model for everything again and rewrites the recordings. Recording needs an OpenRouter key in `dev-vault/.obsidian/plugins/vikalp/data.json` (that folder is gitignored; the plugin moves the key into the test profile's secret storage on load), and replay still needs it, since without a key the judgment rules are skipped.

## Screenshots

`npm run shots` drives the dev vault through the main features in light and dark themes and writes PNGs to `docs/screenshots/`. Look at them after any UI change. Then `python3 e2e/crop-guide.py` refreshes the cropped images in `docs/screenshots/guide/` that the user guide shows.
