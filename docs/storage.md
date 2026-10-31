# Storage

Your notes stay plain markdown. Vikalp never writes markup into them. Everything else goes in a small JSON file per note.

## Where

`.obsidian/plugins/vikalp/notes/<sha1 of the note path>.json`

The file includes the note path, so you can find it by searching the folder. Delete a sidecar and the note is still a normal note; you just lose its alternatives, ghosts and Overflow.

Notes with nothing worth keeping (no spans, ghosts, Overflow blocks or lint marks, and markers off) have no sidecar.

## What is in it

```jsonc
{
  "schema": 1,
  "path": "Essays/The cost of the obvious.md",
  "markersOn": true,
  "spans": [
    {
      "id": "sp_8f2k9qab",
      "unit": "word",                       // word | sentence | paragraph
      "anchor": { "start": 112, "end": 119, "exact": "tension", "prefix": "Much of the ", "suffix": " in making things" },
      "activeVersion": "v_01",
      "versions": [
        { "id": "v_00", "text": "tension", "source": "human", "createdAt": 1759600000000 },
        { "id": "v_02", "text": "friction", "source": "ai", "model": "openai/gpt-6-luna", "createdAt": 1759600200000 }
      ],
      "note": "too abstract?",              // optional
      "hiddenIn": "sp_…",                   // set while a paragraph version without this span is showing
      "orphaned": true,                     // set when its text could not be found
      "lastText": "tension"                 // text used to place it again
    }
  ],
  "ghosts": [{ "id": "gh_…", "createdAt": 1759600300000, "anchor": { … } }],
  "overflow": [{ "id": "ov_…", "text": "A paragraph I cut", "createdAt": 1759600400000 }],
  "lint": { "ranAt": 1759600500000, "hits": [{ "ruleId": "hedging", "label": "Hedging", "message": "Hedge: 'I think'", "anchor": { … } }] }
}
```

Rules:

- The note always holds the active version's text. `anchor.exact` is that text at save time.
- Spans never partly overlap. A span may contain others (a paragraph span around word spans).
- Saves happen half a second after the last change. Unchanged content is not rewritten.
- `schema` goes up on any breaking change, with a migration step in `src/persistence/migrations.ts`.

## API keys

AI provider keys are not in `data.json`. They go in Obsidian's secret storage on the device, under `vikalp-api-key-<provider>`, so syncing `.obsidian/` never carries them. A key saved by a version before 0.1.4 is moved out of `data.json` the first time the plugin loads. Keys don't sync between devices; each device needs its own.

## Finding text again

When a note opens, each anchor is placed in this order:

1. The stored position still holds the same text: done.
2. Search for the exact text near the old position, then anywhere. If it appears more than once, the surrounding 32 characters decide.
3. Fuzzy search allowing up to 20% edits (the approach the Hypothesis annotator uses).
4. Otherwise the span becomes an orphan. Orphans are not drawn. The Alternatives panel lists them under **Unplaced**, with **Place on selection** and **Delete**.

While a note is open, positions simply follow your edits.

## Renames and deletes

Renaming a note moves its sidecar. Deleting a note moves the sidecar to `.obsidian/plugins/vikalp/trash/`, where it is kept for 30 days.

## Limitations

- **Sync.** Sidecars live in `.obsidian/`. Obsidian Sync carries them if plugin settings sync is on. If you sync your vault with git and ignore `.obsidian/`, sidecars won't travel.
- **Two panes on the same note.** Both editors load the same sidecar, but they don't share live state. The last one to change saves. Avoid editing alternatives in two panes of one note at once.
- **Reading mode** shows ghosted text dimmed and nothing else.
