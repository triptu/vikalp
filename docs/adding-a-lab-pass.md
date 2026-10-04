# Adding a Lab pass

A Lab pass asks a model to mark text. It never rewrites. Adding one takes three small changes.

1. **Name it.** Add an entry to `LAB_PASSES` in `src/core/ai/passes.ts`: an id, the button label, a short label for its marks, and a one-line description.
2. **Instruct it.** Add the instructions to `PASS_INSTRUCTIONS` in `src/core/ai/prompts/marks.ts`. Say exactly what to quote (a word, a clause, a whole sentence) and what a reason should look like. Tell it that returning nothing is fine.
3. **Run it.** `LabService.runPass` in `src/plugin/labService.ts` handles every pass the same way. Only add code there if the pass needs extra input, like the long-sentence pass (which sends candidate ids) or the tone pass (which sends voice reference excerpts).

What the shared path does for you:

- numbers the note's sentences and sends them,
- asks for `{ marks: [{ unit_id, quote, reason }] }` through a tool call,
- finds every quote in the note and drops anything that isn't there verbatim,
- replaces the previous marks from the same pass,
- shows the marks in the editor and the Lint panel with an **AI** label.

Only the typo pass may return a `suggestion` (replacement text), and its prompt limits it to spelling, punctuation and agreement. Keep it that way: a pass that suggests wording is a pass that writes.

Add a test for any new prompt-building logic in `tests/core/ai.test.ts`.
