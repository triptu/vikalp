import { invertedEffects } from "@codemirror/commands";
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import type { OverflowBlock } from "../core/model/types";

export const addOverflowBlock = StateEffect.define<{ block: OverflowBlock; index: number }>();
export const removeOverflowBlock = StateEffect.define<{ id: string }>();
export const updateOverflowBlock = StateEffect.define<{ id: string; text: string }>();
export const moveOverflowBlock = StateEffect.define<{ id: string; index: number }>();
export const loadOverflow = StateEffect.define<OverflowBlock[]>();

/** The note's Overflow stash. Stashing and inserting are undoable with the text change they belong to. */
export const overflowField = StateField.define<readonly OverflowBlock[]>({
	create: () => [],
	update(blocks, tr) {
		let next = blocks;
		for (const effect of tr.effects) {
			if (effect.is(loadOverflow)) next = effect.value;
			else if (effect.is(addOverflowBlock)) {
				const copy = next.filter((block) => block.id !== effect.value.block.id);
				copy.splice(Math.min(effect.value.index, copy.length), 0, effect.value.block);
				next = copy;
			} else if (effect.is(removeOverflowBlock)) next = next.filter((block) => block.id !== effect.value.id);
			else if (effect.is(updateOverflowBlock)) {
				next = next.map((block) => (block.id === effect.value.id ? { ...block, text: effect.value.text } : block));
			} else if (effect.is(moveOverflowBlock)) {
				const moving = next.find((block) => block.id === effect.value.id);
				if (moving) {
					const copy = next.filter((block) => block.id !== effect.value.id);
					copy.splice(Math.min(effect.value.index, copy.length), 0, moving);
					next = copy;
				}
			}
		}
		return next;
	},
	provide: (field) =>
		invertedEffects.of((tr) => {
			const start = tr.startState.field(field, false) ?? [];
			const inverses: StateEffect<unknown>[] = [];
			for (const effect of tr.effects) {
				if (effect.is(addOverflowBlock)) inverses.push(removeOverflowBlock.of({ id: effect.value.block.id }));
				else if (effect.is(removeOverflowBlock)) {
					const index = start.findIndex((block) => block.id === effect.value.id);
					if (index !== -1) inverses.push(addOverflowBlock.of({ block: start[index], index }));
				}
			}
			return inverses;
		}),
});

export interface NoteMode {
	/** Path of the note this editor shows, once known. */
	path: string | null;
	/** True once the sidecar has been read into the editor. */
	loaded: boolean;
	markersOn: boolean;
	readThrough: boolean;
	/** Span whose paragraph stays bright while the Alternatives panel has focus. */
	focusedSpan: string | null;
	/** Trim proposal the walk-through is sitting on. */
	walkProposal: string | null;
}

export const setNoteMode = StateEffect.define<Partial<NoteMode>>();

/** The note an editor is showing. Async work checks it to drop results meant for another note. */
export function notePathOf(view: { state: EditorState }): string | null {
	return view.state.field(noteModeField, false)?.path ?? null;
}

export const noteModeField = StateField.define<NoteMode>({
	create: () => ({ path: null, loaded: false, markersOn: false, readThrough: false, focusedSpan: null, walkProposal: null }),
	update(mode, tr) {
		let next = mode;
		for (const effect of tr.effects) if (effect.is(setNoteMode)) next = { ...next, ...effect.value };
		return next;
	},
});

/** Spans that just swapped versions, briefly marked so the new text can fade in. */
export const flashSpan = StateEffect.define<{ id: string } | null>();
export const flashField = StateField.define<string | null>({
	create: () => null,
	update(value, tr) {
		for (const effect of tr.effects) if (effect.is(flashSpan)) return effect.value?.id ?? null;
		return value;
	},
});
