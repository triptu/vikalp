import type { EditorState, StateEffect } from "@codemirror/state";
import { makeAnchor, resolveAnchor } from "../core/anchor/anchor";
import { activeVersionOf, syncActiveText } from "../core/model/span";
import type { Anchor, NoteFile, SpanMeta, TextRange } from "../core/model/types";
import { ghosts, lintMarks } from "./collections";
import { loadOverflow, noteModeField, overflowField, setNoteMode } from "./noteFields";
import { listSpans, loadSpans } from "./spansField";

/** Builds the sidecar for a note from its editor state. Active version texts are synced from the document. */
export function serializeNote(state: EditorState, path: string, lintRanAt: number | null): { note: NoteFile; isEmpty: boolean } {
	const doc = state.doc.toString();
	const mode = state.field(noteModeField);
	const spans = listSpans(state).map(({ meta, range }) => {
		const synced = range ? syncActiveText(meta, doc.slice(range.from, range.to)) : meta;
		const anchor: Anchor = range ? makeAnchor(doc, range) : unplacedAnchor(synced);
		return { ...synced, anchor };
	});
	const ghostEntries = ghosts.list(state).map(({ meta, range }) => ({ ...meta, anchor: makeAnchor(doc, range) }));
	const overflow = [...state.field(overflowField)];
	const hits = lintMarks.list(state).map(({ meta, range }) => ({ ...meta, anchor: makeAnchor(doc, range) }));
	const note: NoteFile = { schema: 1, path, markersOn: mode.markersOn, spans, ghosts: ghostEntries, overflow };
	if (hits.length > 0) note.lint = { ranAt: lintRanAt ?? Date.now(), hits };
	const isEmpty = spans.length === 0 && ghostEntries.length === 0 && overflow.length === 0 && hits.length === 0 && !mode.markersOn;
	return { note, isEmpty };
}

function unplacedAnchor(meta: SpanMeta): Anchor {
	const text = meta.lastText ?? activeVersionOf(meta).text;
	return { start: -1, end: -1, exact: text, prefix: "", suffix: "" };
}

export interface LoadReport {
	effects: StateEffect<unknown>[];
	orphaned: number;
	reanchored: number;
}

/**
 * Turns a sidecar into the effects that load it into an editor, finding each
 * anchor in the current text. Spans that can't be found become orphans, and
 * spans that would cross another span are dropped.
 */
export function loadNoteEffects(doc: string, note: NoteFile): LoadReport {
	let orphaned = 0;
	let reanchored = 0;
	const placed: TextRange[] = [];
	const crosses = (range: TextRange) =>
		placed.some((other) => other.from < range.to && range.from < other.to && !(other.from <= range.from && range.to <= other.to) && !(range.from <= other.from && other.to <= range.to));

	const spanEntries: Array<{ meta: SpanMeta; range: TextRange | null }> = [];
	const sortedSpans = [...note.spans].sort((a, b) => b.anchor.end - b.anchor.start - (a.anchor.end - a.anchor.start));
	for (const { anchor, ...meta } of sortedSpans) {
		if (meta.hiddenIn) {
			spanEntries.push({ meta, range: null });
			continue;
		}
		const range = anchor.start >= 0 || meta.orphaned ? resolveAnchor(doc, anchor) : null;
		if (!range) {
			orphaned++;
			spanEntries.push({ meta: { ...meta, orphaned: true, lastText: anchor.exact }, range: null });
			continue;
		}
		if (crosses(range)) {
			console.warn(`Vikalp: dropped span ${meta.id} because it crosses another span.`);
			continue;
		}
		if (range.from !== anchor.start) reanchored++;
		placed.push(range);
		const cleanMeta: SpanMeta = { ...meta };
		delete cleanMeta.orphaned;
		delete cleanMeta.lastText;
		spanEntries.push({ meta: cleanMeta, range });
	}

	const ghostEntries = note.ghosts.flatMap(({ anchor, ...meta }) => {
		const range = resolveAnchor(doc, anchor);
		return range ? [{ meta, range }] : [];
	});
	const lintEntries = (note.lint?.hits ?? []).flatMap(({ anchor, ...meta }) => {
		const range = resolveAnchor(doc, anchor);
		return range ? [{ meta, range }] : [];
	});

	return {
		orphaned,
		reanchored,
		effects: [
			loadSpans.of(spanEntries),
			ghosts.effects.replaceAll.of(ghostEntries),
			lintMarks.effects.replaceAll.of(lintEntries),
			loadOverflow.of(note.overflow),
			setNoteMode.of({ markersOn: note.markersOn, loaded: true, path: note.path }),
		],
	};
}
