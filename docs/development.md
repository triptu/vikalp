# Development

- `npm run dev` builds in watch mode into `dev-vault/`. Open `dev-vault` in Obsidian with the Hot Reload plugin to see changes live.
- `npm test` runs behaviour tests. `npm run e2e` runs the end-to-end flows in an isolated Obsidian. `npm run shots` refreshes the screenshots.
- `npm run check` typechecks, tests, builds, and fails if `manifest.json`, `package.json` and `versions.json` disagree. CI runs it on every push, plus Obsidian's review lint (`npm run lint`, after the install step in `.github/workflows/ci.yml`).
- Start with [architecture.md](architecture.md). Storage is described in [storage.md](storage.md), rules in [rules.md](rules.md), tests in [testing.md](testing.md), and new Lab passes in [adding-a-lab-pass.md](adding-a-lab-pass.md).

## Releasing

1. `node scripts/bump-version.mjs patch` (or `minor`, `major`, or an exact version). It updates `manifest.json`, `package.json`, `package-lock.json` and `versions.json`. Versions are plain `x.y.z`.
2. `npm run check`.
3. Commit, then `git tag <version> && git push origin <version>`. The tag is the bare version with no `v`.
4. Pushing the tag runs `.github/workflows/release.yml`. It checks the tag matches `manifest.json`, runs `npm run check`, attests `main.js`, `manifest.json` and `styles.css` with GitHub artifact attestations, and publishes a release, marked latest, with those three files.
5. Once the release is published, push `main`. Obsidian's directory reads `manifest.json` from `main` and looks for a release with that version, so the release has to exist before `main` names it.

## Notes for your vault

- Vikalp shows its own word count (without ghosted words) in the status bar. If Obsidian's core *Word count* plugin is on, you'll see two counts; turn the core one off in Settings → Core plugins if that bothers you.
- Sidecars live in `.obsidian/plugins/vikalp/notes/`. See [storage.md](storage.md) for what that means for sync.
