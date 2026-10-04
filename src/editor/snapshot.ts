import type { EditorState } from "@codemirror/state";
import { countVisibleWords } from "../core/text/clean";
import { countWords } from "../core/text/segment";
import type { LintHitView, NoteView, SpanView } from "../store/uiStore";
import { ghosts, lintMarks, trimProposals } from "./collections";
import { noteModeField, overflowField } from "./noteFields";
import { listSpans, spanAt } from "./spansField";

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** A plain-data picture of one note's Vikalp state, for the panels and status bar. */
export function snapshotNote(state: EditorState, path: string): NoteView {
	const doc = state.doc.toString();
	const mode = state.field(noteModeField);
	const bodyStart = FRONTMATTER.exec(doc)?.[0].length ?? 0;
	const ghostRanges = ghosts.list(state).map((entry) => entry.range);
	const bodyGhosts = ghostRanges
		.map((range) => ({ from: Math.max(range.from - bodyStart, 0), to: range.to - bodyStart }))
		.filter((range) => range.to > range.from);
	const wordCounts = countVisibleWords(doc.slice(bodyStart), bodyGhosts);
	const selection = state.selection.main;
	const proposals = trimProposals.list(state);

	const spans: SpanView[] = listSpans(state).map(({ meta, range }) => ({
		id: meta.id,
		unit: meta.unit,
		versions: meta.versions,
		activeVersion: meta.activeVersion,
		note: meta.note ?? "",
		text: range ? doc.slice(range.from, range.to) : null,
		hidden: Boolean(meta.hiddenIn),
		orphaned: Boolean(meta.orphaned),
		lastText: meta.lastText ?? null,
	}));

	const lintHits: LintHitView[] = lintMarks.list(state).map(({ meta, range }) => ({
		id: meta.id,
		ruleId: meta.ruleId,
		label: meta.label,
		message: meta.message,
		severity: meta.severity,
		scope: meta.scope,
		source: meta.source,
		byAi: meta.source === "lab" || Boolean(meta.judgment),
		excerpt: meta.scope === "document" ? "" : doc.slice(range.from, range.to),
		from: range.from,
		...(meta.suggestion !== undefined ? { suggestion: meta.suggestion } : {}),
		...(meta.model ? { model: meta.model } : {}),
	}));

	return {
		path,
		title: path.replace(/^.*\//, "").replace(/\.md$/, ""),
		loaded: mode.loaded,
		markersOn: mode.markersOn,
		readThrough: mode.readThrough,
		words: wordCounts.visible,
		selectedWords: selection.empty ? 0 : countWords(doc.slice(selection.from, selection.to)),
		ghostWords: wordCounts.hidden,
		ghostCount: ghostRanges.length,
		spans,
		cursorSpanId: spanAt(state, selection.head),
		overflow: [...state.field(overflowField)],
		lintHits,
		proposalCount: proposals.length,
		proposalWords: proposals.reduce((sum, entry) => sum + countWords(doc.slice(entry.range.from, entry.range.to)), 0),
	};
}
