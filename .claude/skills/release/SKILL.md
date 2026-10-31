---
name: release
description: Release a new version of Vikalp to GitHub, where Obsidian picks it up. Use when the maintainer says "release", "ship a new version" or "cut a release".
---

# Release a new version

A version tag runs `.github/workflows/release.yml`: it checks the tag matches `manifest.json`, runs `npm run check`, attests `main.js`, `manifest.json` and `styles.css`, and publishes a GitHub release with those three files. Obsidian reads `manifest.json` from `main` and downloads the files from the release whose tag matches its version, so the release has to exist before `main` names it.

1. **Start from a clean, pushed `main`.** `git status` must be clean and `git log origin/main..main` empty. If there are unpushed commits, say so and ask before pushing.
2. **Pick the bump.**
   - `patch` for fixes and small changes (the default).
   - `minor` when the release adds a feature.
   - `major` only when the maintainer asks.
   Say which bump you picked and why in one line, then go on. The maintainer asking to release is the go-ahead.
3. **Run e2e if the editor, panels, persistence or linter changed since the last release** (`git diff --stat <last tag> -- src/`). CI can't run it. Use the `run-e2e` skill; stop and report if a flow fails twice.
4. **Bump and check:** `node scripts/bump-version.mjs <bump>`, then `npm run check`. Commit the four version files as `Release <version>`.
5. **Tag and push the tag first:** `git tag <version> && git push origin <version>`. Tags have no `v`. Watch the run with `gh run list --workflow release.yml --limit 1 --json databaseId` and `gh run watch <id> --exit-status`.
6. **If it fails,** show the failing step from `gh run view <id> --log-failed`, delete the tag locally and on GitHub (`git tag -d <version>; git push origin :refs/tags/<version>`), fix, and go back to step 4. Nothing on `main` has changed yet.
7. **When the release is published,** `git push origin main` and report the version and the URL from `gh release view <version> --json url`.

Notes:

- The repo has to be public for Obsidian's directory to see releases. The first listing is submitted by hand at community.obsidian.md; later releases are picked up on their own.
- `minAppVersion` only changes when Vikalp starts using a newer Obsidian API. Update it in `manifest.json` in a normal commit before releasing; the bump script copies it into `versions.json`.
- Commit messages get no co-author or Claude attribution lines.
