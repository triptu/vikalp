---
name: run-e2e
description: Run Vikalp's end-to-end flows in a real, isolated Obsidian. Use after changing editor, panel, persistence or linter behaviour.
---

# Run the e2e flows

1. `npm run build` (e2e uses the built `main.js` in the dev vault).
2. `npm run e2e` for everything, or `npm run e2e -- <name part>` for the group holding that flow. Add `--live` to ask the model again instead of replaying `e2e/ai-recordings.json`.

What to know:

- The harness copies `dev-vault/` to `e2e/.artifacts/vault/` and launches `/Applications/Obsidian.app` with `--user-data-dir=e2e/.profile` and a debugging port (9333). The maintainer's running Obsidian and real vault are never touched.
- If a run is killed, stop only the isolated instance: `pkill -f "user-data-dir=.*vikalp/e2e/.profile"`. Never kill other Obsidian processes.
- The installer in `/Applications` is older than the app Obsidian downloads for itself, so the harness copies the newest `obsidian-<version>.asar` from `~/Library/Application Support/obsidian/` into the test profile. The window title shows the version that ran.
- Since Obsidian 1.13, settings open in their own window. Use `driver.openSettings()`, which returns that window's page, to query or click inside settings.
- A new scratch vault path triggers Obsidian's "trust author" prompt; `e2e/obsidian.mjs` clicks it.
- The driver finds the editor through `window.app.plugins.plugins.vikalp.controller.editor`, because `workspace.activeEditor` is null while a Vikalp panel has focus.
- Flows in `e2e/run.mjs` are grouped; each group shares one Obsidian, and flows build on each other's edits. To test state across restarts, add a `restart(between)` step to a group.
- AI answers are replayed from `e2e/ai-recordings.json`; misses go to the model and get recorded. Commit that file when it changes. The key in `dev-vault/.obsidian/plugins/vikalp/data.json` (gitignored) is still needed.
