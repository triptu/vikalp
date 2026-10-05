---
name: release
description: Release a new version of Vikalp to GitHub, where Obsidian picks it up. Use when Tushar says "release", "ship a new version" or "cut a release".
---

# Release a new version

The Release workflow (`.github/workflows/release.yml`) does the work: typecheck and tests, version bump in `manifest.json`, `package.json`, `package-lock.json` and `versions.json`, a "Release x.y.z" commit and tag on `main`, a build, and a published GitHub release with `main.js`, `manifest.json` and `styles.css`. It releases what is on GitHub's `main`, not the local checkout.

1. **Make sure `main` on GitHub has what should ship.** `git status` must be clean and `git log origin/main..main` empty. If there are unpushed commits, say so and ask before pushing.
2. **Pick the bump.**
   - `patch` for fixes and small changes (the default).
   - `minor` when the release adds a feature.
   - `major` only when Tushar asks.
   - If `gh release list` is empty, this is the first release: use the exact version in `manifest.json` (for example `0.1.0`) so it isn't skipped.
   Say which bump you picked and why in one line, then go on. Tushar asking to release is the go-ahead.
3. **Run e2e if the editor, panels, persistence or linter changed since the last release** (`git diff --stat <last tag> -- src/`). CI can't run it. Use the `run-e2e` skill; stop and report if a flow fails twice.
4. **Start the release:** `gh workflow run release.yml -f bump=<bump>`. Then find the run with `gh run list --workflow release.yml --limit 1 --json databaseId` and wait with `gh run watch <id> --exit-status`.
5. **If it fails,** show the failing step from `gh run view <id> --log-failed` and stop. A failure before "Commit and tag" changes nothing on GitHub.
6. **When it passes,** `git pull` so the local `main` has the release commit, and report the version and the URL from `gh release view <version> --json url`.

Notes:

- Obsidian reads `manifest.json` from `main` and downloads the files from the release whose tag matches its version. Tags have no `v`.
- The repo has to be public for Obsidian's directory to see releases. The first listing is submitted by hand at community.obsidian.md; later releases are picked up on their own.
- `minAppVersion` only changes when Vikalp starts using a newer Obsidian API. Update it in `manifest.json` in a normal commit before releasing; the bump script copies it into `versions.json`.
- Commit messages get no co-author or Claude attribution lines.
