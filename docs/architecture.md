# Architecture

Vikalp is an Obsidian plugin built on CodeMirror 6 (the editor inside Obsidian), Preact for panels, and zustand for UI state. This page explains where things live and why.

## Layers

```
src/
  core/          pure TypeScript. No Obsidian, no CodeMirror. Tested in plain Node.
    model/       spans, versions, ghosts, overflow blocks, lint hits, the sidecar shape
    anchor/      finding text again after the note changed (exact, nearby, fuzzy)
    text/        sentences, paragraphs, word counts, a/an, tidy deletions
    rules/       the linter: rule types, YAML parsing, local engines, built-in rules
    ai/          prompts, output schemas, placing model quotes in the note
  editor/        CodeMirror state fields, decorations, keymaps, tooltips, actions
  persistence/   one JSON sidecar per note
  ai/            the model client (pi-ai) and its backends
  store/         the zustand UI store
  views/         Preact components, hooks and the Obsidian panel shells
  plugin/        Obsidian wiring: commands, menus, status bar, settings, services
  main.ts        creates everything and connects it
```

Lower layers never import higher ones. `core/` imports nothing from the rest. Components in `views/components/` get data and callbacks from hooks and never touch CodeMirror, the vault or the store directly.

## Where state lives

There are two kinds of state, and they live in different places on purpose.

**Undoable state lives in CodeMirror.** Spans and their versions, ghosts, and the Overflow stash are CodeMirror `StateField`s (`editor/spansField.ts`, `editor/rangeCollection.ts`, `editor/noteFields.ts`). Every change is a transaction with effects. Each field registers `invertedEffects`, so Cmd+Z undoes a version swap, a deleted version, a stash or a ghost together with the text change it came with. If this state lived in a separate store, undo would revert the text and leave the store behind.

Ranges are stored as `RangeSet`s, so they follow the text as you type. When you delete all the text of a span, the span goes away and undo brings it back. When text disappears for another reason, such as the file being rewritten on disk, the span is re-anchored by its text instead, or kept as an orphan.

Lint marks and trim proposals live in CodeMirror too, so they move with the text, but they are not part of undo.

**Everything else lives in the zustand store** (`store/uiStore.ts`): which span the panel shows, AI requests in flight, linter progress, the trim pass, the cost log, the model mode. After each relevant editor update, `NoteController` takes a plain snapshot of the active note (`editor/snapshot.ts`) and puts it in the store. Panels read that snapshot through hooks.

## Flow of a change

1. A command, menu item, key or panel button calls an action in `editor/actions.ts`. Actions are pure: they take the editor state and return a transaction spec, or a message explaining why they can't run.
2. `runAction` dispatches the transaction (in its own undo step) or shows the message.
3. The state fields update. Decorations recompute from the fields.
4. `NoteController` sees the update, publishes a snapshot to the store, and schedules a sidecar save.
5. Panels re-render from the store.

Because actions are pure functions of editor state, the tests in `tests/editor/` run them against a headless CodeMirror state, including undo and redo.

## Editors and notes

Obsidian can show several notes at once. `NoteController` keeps one entry per CodeMirror view. When a view appears or switches to another file, the controller reads that note's sidecar, re-anchors everything against the current text, and loads it into the view with a single non-undoable transaction. Saves wait until the load has finished, so an empty editor can never overwrite a real sidecar.

The "active" editor is the last markdown editor the user worked in. Panels keep pointing at it while they have focus.

## AI

`ai/aiClient.ts` wraps pi-ai. Where calls go and how they are authorised lives in a backend (`ai/backend.ts`), built for each call from settings by `ai/backends.ts`.

The writer picks a provider preset (`core/providers.ts`): OpenRouter, Anthropic, OpenAI, Ollama, LM Studio or Custom. A preset only fills in the server URL, and the URL's host decides the protocol: `openrouter.ai`, `api.anthropic.com` and `api.openai.com` use pi-ai's own provider and price list for each; anything else is treated as an OpenAI-compatible server. OpenRouter calls all go through its OpenAI-style endpoint, since its CORS rules block the Anthropic SDK's headers from Obsidian. Each provider keeps its own key, URL and models in settings. OpenRouter, Anthropic and OpenAI offer Lite, Medium and Heavy; the others run one model, picked from the server's `/models` list. The model lists for each mode come from `core/modelChoices.ts`: the newest model of each family in pi-ai's catalog, and on OpenRouter open-weight picks from its benchmarks API (`ai/openModels.ts`), saved in `model-picks.json` in the plugin folder and refreshed at most once a day.

Every call:

- runs only from a click or command,
- asks for structured output through a single tool call (with a JSON fallback),
- records its cost in the store, marked as priced, free (a server on this computer) or unpriced (a server whose prices Vikalp doesn't know).

Models never get character offsets. Prompts number the sentences (`[s4] …`) and models answer with a sentence id plus an exact quote. `core/ai/placement.ts` finds each quote with the anchoring code and rejects anything that isn't there verbatim. See [adding-a-lab-pass.md](adding-a-lab-pass.md).

Jev (TypeSafe's yes/no model) handles the linter's AI rules and the grammar check after a trim. It runs on OpenRouter only. If Jev fails, the linter falls back to the Lite model and says so. Other providers send judgments to the selected model and skip the grammar check.

## Views

Each panel is an Obsidian `ItemView` that renders one Preact tree (`views/panelViews.ts`). The Lab popover and the trim bar are Preact trees mounted by `plugin/overlays.ts`. Styles are in `styles.css` and use only Obsidian's CSS variables.
