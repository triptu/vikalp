# Using Vikalp

Vikalp helps you settle on the right way to say something. Keep several versions of a word, sentence or paragraph in place and read each one in context. Dim text instead of deleting it. Keep spare writing nearby. Lint on demand. Ask AI for options, marks and cuts, never for prose.

Nothing runs or costs money until you click something.

## Markers

The word count in the status bar is also the switch. Click it to show or hide Vikalp markers for the note. Creating a span turns markers on for you.

- A word or sentence with versions has a thin underline and a row of tiny dots under its end. One dot per version; the bright one is showing. The first dot is the original, so you can tell when you're on a variant.
- A paragraph with versions has a thin bar in the left margin with a column of dots.
- A yellow dot means the span has a note. Hover it to read the note.

![Word spans with their dot rows, and a span note on hover](screenshots/guide/markers.png)

![A paragraph span: the bar and dots in the left margin](screenshots/guide/paragraph-span.png)

## Alternatives

1. Select a word, phrase, sentence or paragraph. Press **⌘⇧A** (or right-click → *Alternatives for selection*). A partial word grows to the whole word.
2. The Alternatives panel opens on the left with the cursor in its input. Type a version and press **Return**. It shows in the note straight away.
3. Add as many as you like. **↑/↓** in the panel swaps the version in the note as you go.
4. **Esc** goes back to the note. A span you never gave a second version quietly disappears.

![The Alternatives panel with three versions of "tension"](screenshots/guide/alternatives-panel.png)

To cycle in the note:

- **Hover** the span and press the **arrow keys**. Typing disarms this until you move the mouse again, so arrows never get stolen while you write.
- Or put the cursor in the span and press **⌥↑ / ⌥↓**.
- **⌥⌫** while hovering deletes the showing version.

There's no accept step. Whatever is showing is the note. Undo (**⌘Z**) reverses any swap.

When you swap, a preceding "a" or "an" is fixed to match ("a thumbtack" → "an eraser").

The **Word · Sentence · Paragraph** tabs grow the current span or selection to that unit.

A paragraph span can contain word spans. If you switch to a paragraph version that doesn't contain one of them, it hides until a version that does comes back.

**Settle** keeps the showing version and drops the rest. *Settle all alternatives in note* does it for every span, after asking.

### AI alternatives

- Select text and press **⌘⇧G**, or type **??** in the panel input and press Return, or click **Ask AI**.
- Options stream in marked with a small robot. Your showing version never changes; you pick.
- Each AI version remembers which model wrote it (hover it in the panel).
- *Remove AI versions* clears them from a span. AI versions aren't part of undo, so ⌘Z never steps through them.
- **Find words worth playing with** (in the Lab, or right-click a selection) does this for the whole note in one go. The model picks up to 8 words or short phrases where the wording matters most and adds versions to each. Nothing in the note changes; hover a marked word and use the arrow keys. *Remove all AI versions in note* clears them again.

![AI versions, marked with a robot, below the ones you wrote](screenshots/guide/ai-alternatives.png)

## Ghosting

Select text and press **⌘⇧/** (or right-click → *Ghost it*). It fades to about 10% and stays in the note. Hover to read it. Right-click → *Revive* brings it back.

Ghosted words aren't counted in the status bar; the count shows them as "(+12 ghosted)". *Copy clean text* copies the note without them. *Delete all ghosted text in note* removes them for good, after asking.

![A ghosted sentence, still in the note at about 10%](screenshots/guide/ghost.png)

## Overflow

A side panel for writing you cut but want nearby. Each note has its own.

- Select text and press **⌘⇧X** to move it to Overflow.
- Drag a block back into the note, or focus it and press **⌘J** to insert it at the cursor. Hold **⌥** to keep a copy.
- Blocks are editable. Drag them to reorder.
- With a span open in the Alternatives panel, the split icon on a block makes it a version of that span.

![The Overflow panel with one stashed block](screenshots/guide/overflow.png)

## Linter

Click the lint icon in the status bar, the **Run linter** button in the Lint panel, or run *Vikalp: Run linter*. Free local rules finish at once. Judgment rules (awkward, LinkedIn voice, AI-sounding paragraphs, and so on) fill in as Jev answers.

Hover a mark to see which rules it hit, and fix or ignore it. Click a hit in the panel to jump to it. Marks made by a model (Jev or an LLM) carry an **AI** label and a faint dashed underline.

![Lint marks in the note, a hover card, and the Lint panel grouped by rule](screenshots/guide/linter.png)

Rules live in Settings → Vikalp → Rules, grouped by name. Switch a group or a single check off, open any rule to edit it in a form, or press **Add rule**. The form previews how many marks a rule makes on the open note before you save. Select a phrase you hate and run *New rule from selection* to flag it everywhere from now on. See [rules.md](rules.md).

## The Lab

Click **Lab** in the status bar.

![The Lab popover](screenshots/guide/lab.png)

- **Model**: Lite, Medium or Heavy. Applies to every AI action. The status bar shows the current mode next to **Lab**.
- **Mark** passes add marks you can review in the Lint panel: typos and punctuation (with Apply / Ignore and *Apply all*), weakest sentences, sentences that run long, convoluted sentences, words that don't fit the tone, and hedges and filler.
- **Trim** levels fade the words the model would cut, from ~10% to ~50%. Click a faded passage to keep it. Then **Ghost the cuts** (nothing is deleted), **Make the cuts**, or **Walk through** them one at a time with **K**eep, **C**ut, **S**kip. **Done** discards what's left. Switching levels keeps the passages you chose to keep.

![The typo pass: each fix shows on hover with Apply and Ignore](screenshots/guide/typo-pass.png)

![A slight trim: faded words would go, and the trim bar shows the word count change](screenshots/guide/trim.png)

The model may only quote your own text. Anything it can't quote exactly is dropped and counted.

## Read-through

**⌘⇧R** hides every marker, collapses the sidebars and narrows the text so you read like a reader. Ghosted text stays dimmed. **Esc** returns.

![Read-through mode](screenshots/guide/read-through.png)

## Cost

The status bar shows this session's AI spend next to the model mode. The Lab popover links to a log of every call: what it was for, the model, tokens and cost. Each linter run also shows its own cost in the Lint panel.

## Hotkeys

| Action | Default |
|---|---|
| Alternatives for selection | ⌘⇧A |
| AI alternatives for selection | ⌘⇧G |
| Cycle the hovered span | arrow keys |
| Cycle the span at the cursor | ⌥↑ / ⌥↓ |
| Delete the hovered version | ⌥⌫ |
| Ghost it | ⌘⇧/ |
| Stash in Overflow | ⌘⇧X |
| Insert an Overflow block | ⌘J (block focused) |
| Read-through mode | ⌘⇧R |

The ⌘ shortcuts can be changed in Settings → Hotkeys. The arrow, ⌥↑/↓ and ⌥⌫ keys are built into the editor; the commands *Next version* and *Previous version* can be bound to other keys if you prefer. Every other action is a command (search "Vikalp" in the command palette).
