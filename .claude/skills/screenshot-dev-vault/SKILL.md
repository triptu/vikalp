---
name: screenshot-dev-vault
description: Take and review screenshots of Vikalp in the dev vault (light and dark). Use after any UI or CSS change, before calling the change done.
---

# Screenshot the dev vault

- Full gallery: `npm run build && npm run shots` writes `docs/screenshots/<theme>-NN-name.png`. Add `-- dark` for one theme or `--no-ai` to skip paid AI steps.
- Ad hoc: write a small script with `startSession()` and the driver in `e2e/driver.mjs` (`openNote`, `select`, `command`, `type`, `press`, `hover`, `click`, `screenshot`). Save to `/tmp` while iterating.
- Read the PNGs and check against the spec's visual rules: Obsidian variables only, thin markers (1px underline, 3px dots, 2px paragraph bar), quiet by default, nothing animated except the swap fade, looks right in both themes.
- Crop and upscale small details (dots, bars) with PIL before judging them.
- Obsidian's own status bar items sit next to Vikalp's; the right sidebar's bottom is covered by the status bar, so panels keep 36px bottom padding.
