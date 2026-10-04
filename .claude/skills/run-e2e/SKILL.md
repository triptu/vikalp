---
name: run-e2e
description: Run Vikalp's end-to-end flows in a real, isolated Obsidian. Use after changing editor, panel, persistence or linter behaviour.
---

# Run the e2e flows

1. `npm run build` (e2e uses the built `main.js` in the dev vault).
2. `npm run e2e` for everything, or `npm run e2e -- <name part>` for one flow.

What to know:

- The harness copies `dev-vault/` to `e2e/.artifacts/vault/` and launches `/Applications/Obsidian.app` with `--user-data-dir=e2e/.profile` and a debugging port (9333). The maintainer's running Obsidian and real vault are never touched.
- If a run is killed, stop only the isolated instance: `pkill -f "user-data-dir=.*vikalp/e2e/.profile"`. Never kill other Obsidian processes.
- A new scratch vault path triggers Obsidian's "trust author" prompt; `e2e/obsidian.mjs` clicks it.
- The driver finds the editor through `window.app.plugins.plugins.vikalp.controller.editor`, because `workspace.activeEditor` is null while a Vikalp panel has focus.
- To test state across restarts, call `prepareScratchVault()` once, then `startSession({ keepVault: true })` for each launch.
- The linter flow calls Jev live and needs the key in `dev-vault/.obsidian/plugins/vikalp/data.json` (gitignored).
