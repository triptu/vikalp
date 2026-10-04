# Vikalp

*Vikalp* is Hindi for "alternative". It's an Obsidian plugin for settling on the right way to say something: keep several versions of a word, sentence or paragraph in place, dim text instead of deleting it, keep spare writing nearby, lint on demand, and ask AI for options, marks and cuts. The AI never writes prose into your note, and nothing runs until you click.

![Alternatives panel, markers, ghosted text and Overflow](docs/screenshots/dark-02-markers-ghost-overflow.png)

## What it does

- **Alternatives.** Select text, press ⌘⇧A, type versions. Hover and press the arrow keys to read each one in place. Whatever is showing is the note.
- **Ghosting.** Fade a passage to 10% instead of deleting it. Revive it later, or copy the note without it.
- **Overflow.** A per-note side panel for writing you cut but want nearby. Drag it back when it fits.
- **Linter.** Rules for hedging, wordiness, AI-sounding phrases, LinkedIn voice, repetition, passive voice and more. Edit them or add your own as YAML. Judgment rules use Jev, TypeSafe's yes/no model.
- **The Lab.** AI passes that mark typos, weak or convoluted sentences, off-tone words and hedges, and trim levels that fade the words a model would cut. You keep or cut each one.
- **Read-through.** Hide every marker and read like a reader.

Read [docs/using-vikalp.md](docs/using-vikalp.md) for the full guide and hotkeys.

## Install (from source)

```sh
npm install
npm run build
```

Copy `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/vikalp/`, enable Vikalp in Settings → Community plugins, and add an OpenRouter API key in Vikalp's settings for the AI features. Desktop only.

## Develop

- `npm run dev` builds in watch mode into `dev-vault/`. Open `dev-vault` in Obsidian with the Hot Reload plugin to see changes live.
- `npm test` runs behaviour tests. `npm run e2e` runs the end-to-end flows in an isolated Obsidian. `npm run shots` refreshes the screenshots.
- Start with [docs/architecture.md](docs/architecture.md). Storage is described in [docs/storage.md](docs/storage.md), rules in [docs/rules.md](docs/rules.md).

## Docs

- [Using Vikalp](docs/using-vikalp.md)
- [Architecture](docs/architecture.md)
- [Storage](docs/storage.md)
- [Lint rules](docs/rules.md)
- [Adding a Lab pass](docs/adding-a-lab-pass.md)
- [Testing](docs/testing.md)
