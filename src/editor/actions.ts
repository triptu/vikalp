import type { ChangeSpec, EditorState, StateEffect, TransactionSpec } from "@codemirror/state";
import { activeVersionOf, createSpanMeta, createVersion, isDuplicateVersion, versionAfterDelete, versionAtStep } from "../core/model/span";
import { newId } from "../core/model/ids";
import type { SpanMeta, SpanUnit, TextRange, Version, VersionSource } from "../core/model/types";
import { articleFixBefore } from "../core/text/articles";
import { tidyDeletion } from "../core/text/clean";
import { findNonProseRanges, overlapsAny } from "../core/text/markdown";
import { expandToUnit, expandToWords, normalizeSpanRange, trimRange } from "../core/text/segment";
import { ghosts } from "./collections";
import { addOverflowBlock, flashSpan, overflowField, removeOverflowBlock } from "./noteFields";
import { idsInside } from "./ranges";
import {
	addVersion,
	createSpan,
	deleteVersion,
	listSpans,
	placeSpan,
	removeSpan,
	setActiveVersion,
	setSpanNote,
	setVersionText,
	spanMeta,
	spanRange,
	spansField,
} from "./spansField";
import { VIKALP_EVENT, noHistory } from "./transactions";

export type ActionResult<Extra = object> = ({ ok: true; spec: TransactionSpec } & Extra) | { ok: false; message: string };

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

export interface SwitchOptions {
	articleFix: boolean;
}

/**
 * Finds or creates the span for a selection. An empty selection uses the word
 * at the cursor. `unit` grows the selection to a whole sentence or paragraph.
 */
export function createSpanFromSelection(
	state: EditorState,
	selection: TextRange,
	unit?: SpanUnit,
): ActionResult<{ spanId: string; created: boolean }> {
	const doc = state.doc.toString();
	const existing = existingSpanFor(state, selection, unit);
	if (existing) return { ok: true, spec: {}, spanId: existing, created: false };

	let range: TextRange | null;
	let label: SpanUnit;
	if (unit) {
		range = expandToUnit(doc, selection, unit);
		label = unit;
	} else {
		const normalized = normalizeSpanRange(doc, selection);
		range = normalized.range;
		label = normalized.unit;
	}
	if (!range || range.to <= range.from) return fail("Select some text first.");
	if (overlapsAny(range, findNonProseRanges(doc))) return fail("Alternatives can't go inside code, math or frontmatter.");
	if (/\n\s*\n/.test(doc.slice(range.from, range.to))) return fail("Alternatives work on one paragraph at a time.");

	const sameRange = listSpans(state).find((span) => span.range?.from === range!.from && span.range.to === range!.to);
	if (sameRange) return { ok: true, spec: {}, spanId: sameRange.meta.id, created: false };
	const crossing = listSpans(state).find(
		(span) => span.range && span.range.from < range!.to && range!.from < span.range.to && !contains(span.range, range!) && !contains(range!, span.range),
	);
	if (crossing) return fail("That overlaps text that already has versions. Select inside it or all the way around it.");

	const meta = createSpanMeta(doc.slice(range.from, range.to), label);
	return {
		ok: true,
		spanId: meta.id,
		created: true,
		// Not in undo history: a span with one version is invisible scaffolding until a second version arrives.
		spec: { effects: createSpan.of({ meta, range }), annotations: noHistory },
	};
}

function existingSpanFor(state: EditorState, selection: TextRange, unit?: SpanUnit): string | null {
	if (selection.from !== selection.to || unit) return null;
	const doc = state.doc.toString();
	const word = expandToWords(doc, selection);
	// A span with one version is scaffolding left open in the panel; it shouldn't capture words inside it.
	const spans = listSpans(state).filter(
		(span) => span.range && span.meta.versions.length > 1 && span.range.from <= word.from && word.to <= span.range.to,
	);
	spans.sort((a, b) => a.range!.to - a.range!.from - (b.range!.to - b.range!.from));
	return spans[0]?.meta.id ?? null;
}

function contains(outer: TextRange, inner: TextRange): boolean {
	return outer.from <= inner.from && inner.to <= outer.to;
}

/** Moves the span `step` versions forward or back, replacing the text in place. */
export function cycleSpan(state: EditorState, spanId: string, step: number, options: SwitchOptions): ActionResult {
	const meta = spanMeta(state, spanId);
	if (!meta || meta.versions.length < 2) return fail("Nothing to cycle.");
	return switchToVersion(state, spanId, versionAtStep(meta, step), options);
}

/**
 * Makes `version` the active one: swaps the text, fixes a preceding a/an,
 * moves or hides spans nested inside, and flashes the new text.
 */
export function switchToVersion(
	state: EditorState,
	spanId: string,
	version: Version,
	options: SwitchOptions,
	leadingEffects: StateEffect<unknown>[] = [],
): ActionResult {
	const meta = spanMeta(state, spanId);
	const range = spanRange(state, spanId);
	if (!meta || !range) return fail("Those versions aren't placed in the note right now.");
	const doc = state.doc.toString();
	const currentText = doc.slice(range.from, range.to);
	const active = activeVersionOf(meta);

	const effects: StateEffect<unknown>[] = [...leadingEffects];
	if (active.text !== currentText && active.id !== version.id) {
		effects.push(setVersionText.of({ id: spanId, versionId: active.id, text: currentText }));
	}
	const changes: ChangeSpec[] = [];
	let shift = 0;
	const articleFix = options.articleFix ? articleFixBefore(doc, range.from, version.text) : null;
	if (articleFix) {
		changes.push(articleFix);
		shift = articleFix.insert.length - (articleFix.to - articleFix.from);
	}
	changes.push({ from: range.from, to: range.to, insert: version.text });
	const newFrom = range.from + shift;
	const newRange = { from: newFrom, to: newFrom + version.text.length };
	effects.push(setActiveVersion.of({ id: spanId, versionId: version.id, range: newRange }));
	effects.push(...placeNestedSpans(state, meta, range, currentText, version.text, newFrom));
	effects.push(flashSpan.of({ id: spanId }));

	const spec: TransactionSpec = { changes, effects, userEvent: VIKALP_EVENT.cycle };
	const selection = selectionAfterSwap(state, range, newRange);
	if (selection) spec.selection = selection;
	return { ok: true, spec };
}

/**
 * Where the selection goes when the text under it is swapped. CodeMirror would
 * map a selection inside replaced text to a backwards range, so it is set
 * explicitly: a cursor keeps its offset, a selection covers the new text.
 */
function selectionAfterSwap(state: EditorState, oldRange: TextRange, newRange: TextRange): { anchor: number; head?: number } | null {
	const main = state.selection.main;
	if (main.from < oldRange.from || main.to > oldRange.to) return null;
	if (main.empty) return { anchor: Math.min(newRange.from + (main.head - oldRange.from), newRange.to) };
	return { anchor: newRange.from, head: newRange.to };
}

/**
 * Spans inside a span whose text is being replaced: each one moves to where
 * its text appears in the new version, or is hidden until a version that
 * contains it comes back. Spans hidden earlier are restored the same way.
 */
function placeNestedSpans(state: EditorState, parent: SpanMeta, oldRange: TextRange, oldText: string, newText: string, newFrom: number) {
	const effects: StateEffect<unknown>[] = [];
	const value = state.field(spansField);
	const claimed: TextRange[] = [];
	const findInNewText = (text: string, preferredOffset: number): TextRange | null => {
		let best: number | null = null;
		for (let index = newText.indexOf(text); index !== -1; index = newText.indexOf(text, index + 1)) {
			const candidate = { from: newFrom + index, to: newFrom + index + text.length };
			if (claimed.some((range) => range.from < candidate.to && candidate.from < range.to)) continue;
			if (best === null || Math.abs(index - preferredOffset) < Math.abs(best - preferredOffset)) best = index;
		}
		if (best === null) return null;
		const range = { from: newFrom + best, to: newFrom + best + text.length };
		claimed.push(range);
		return range;
	};

	for (const inner of idsInside(value.ranges, oldRange, parent.id)) {
		const text = oldText.slice(inner.range.from - oldRange.from, inner.range.to - oldRange.from);
		const placed = text ? findInNewText(text, inner.range.from - oldRange.from) : null;
		effects.push(placed ? placeSpan.of({ id: inner.id, range: placed }) : placeSpan.of({ id: inner.id, range: null, hiddenIn: parent.id, lastText: text }));
	}
	for (const hidden of value.meta.values()) {
		if (hidden.hiddenIn !== parent.id || !hidden.lastText) continue;
		const placed = findInNewText(hidden.lastText, 0);
		if (placed) effects.push(placeSpan.of({ id: hidden.id, range: placed }));
	}
	return effects;
}

/** Adds a version to a span. Human versions become active at once so they are read in context. */
export function addVersionToSpan(
	state: EditorState,
	spanId: string,
	text: string,
	source: VersionSource,
	options: SwitchOptions & { activate: boolean; model?: string },
): ActionResult<{ version: Version | null }> {
	const meta = spanMeta(state, spanId);
	const cleaned = text.replace(/\s*\n\s*/g, " ").trim();
	if (!meta) return fail("Those versions are gone.");
	if (!cleaned) return fail("Type a version first.");
	if (isDuplicateVersion(meta, cleaned)) {
		const existing = meta.versions.find((version) => version.text.trim() === cleaned);
		if (existing && options.activate && existing.id !== meta.activeVersion) {
			const switched = switchToVersion(state, spanId, existing, options);
			return switched.ok ? { ...switched, version: null } : switched;
		}
		return { ok: true, spec: {}, version: null };
	}
	const version = createVersion(cleaned, source, options.model);
	const add = addVersion.of({ id: spanId, version });
	if (!options.activate || !spanRange(state, spanId)) {
		return { ok: true, version, spec: { effects: add, userEvent: VIKALP_EVENT.edit } };
	}
	const switched = switchToVersion(state, spanId, version, options, [add]);
	return switched.ok ? { ...switched, version } : switched;
}

/**
 * Deletes one version. If it was showing, the neighbour takes its place. A
 * span left with a single version stops being a span.
 */
export function deleteVersionFromSpan(
	state: EditorState,
	spanId: string,
	versionId: string,
	options: SwitchOptions & { prefer: "previous" | "next" },
): ActionResult {
	const meta = spanMeta(state, spanId);
	if (!meta) return fail("Those versions are gone.");
	const isActive = meta.activeVersion === versionId;
	const isOriginal = meta.versions[0]?.id === versionId;
	if (isActive && isOriginal && meta.versions.length > 1) return fail("Switch to another version before deleting the original.");

	const removal = deleteVersion.of({ id: spanId, versionId });
	const remaining = meta.versions.length - 1;
	if (!isActive) {
		const effects: StateEffect<unknown>[] = [removal];
		if (remaining < 2) effects.push(removeSpan.of({ id: spanId }));
		return { ok: true, spec: { effects, userEvent: VIKALP_EVENT.edit } };
	}
	const next = versionAfterDelete(meta, versionId, options.prefer);
	if (!next) return { ok: true, spec: { effects: removeSpan.of({ id: spanId }), userEvent: VIKALP_EVENT.edit } };
	const switched = switchToVersion(state, spanId, next, options, [removal]);
	if (!switched.ok) return switched;
	if (remaining < 2) {
		const effects = [...asArray(switched.spec.effects), removeSpan.of({ id: spanId })];
		return { ok: true, spec: { ...switched.spec, effects } };
	}
	return switched;
}

function asArray(effects: TransactionSpec["effects"]): StateEffect<unknown>[] {
	if (!effects) return [];
	return Array.isArray(effects) ? [...effects] : [effects as StateEffect<unknown>];
}

/** Keeps the showing text and drops every other version, plus spans hidden inside. */
export function settleSpans(state: EditorState, spanIds: string[]): ActionResult<{ count: number }> {
	const ids = new Set(spanIds);
	for (const { meta } of listSpans(state)) if (meta.hiddenIn && ids.has(meta.hiddenIn)) ids.add(meta.id);
	const effects = [...ids].filter((id) => spanMeta(state, id)).map((id) => removeSpan.of({ id }));
	if (effects.length === 0) return fail("No alternatives to settle.");
	return { ok: true, count: spanIds.length, spec: { effects, userEvent: VIKALP_EVENT.edit } };
}

export function removeAiVersions(state: EditorState, spanId: string, options: SwitchOptions): ActionResult<{ removed: number }> {
	const meta = spanMeta(state, spanId);
	if (!meta) return fail("Those versions are gone.");
	const aiVersions = meta.versions.filter((version) => version.source === "ai");
	if (aiVersions.length === 0) return fail("There are no AI versions here.");
	const humanVersions = meta.versions.filter((version) => version.source === "human");
	const removals = aiVersions.map((version) => deleteVersion.of({ id: spanId, versionId: version.id }));
	const activeIsAi = aiVersions.some((version) => version.id === meta.activeVersion);
	let spec: TransactionSpec = { effects: removals, userEvent: VIKALP_EVENT.edit };
	if (activeIsAi) {
		const fallback = humanVersions[humanVersions.length - 1] ?? humanVersions[0];
		if (!fallback) return fail("There is no version of yours to fall back to.");
		const switched = switchToVersion(state, spanId, fallback, options, removals);
		if (!switched.ok) return switched;
		spec = switched.spec;
	}
	if (humanVersions.length < 2) spec = { ...spec, effects: [...asArray(spec.effects), removeSpan.of({ id: spanId })] };
	return { ok: true, removed: aiVersions.length, spec };
}

export function setNoteOnSpan(state: EditorState, spanId: string, note: string): ActionResult {
	if (!spanMeta(state, spanId)) return fail("Those versions are gone.");
	return { ok: true, spec: { effects: setSpanNote.of({ id: spanId, note }), annotations: noHistory } };
}

/** Re-attaches an unplaced span to the selection, which becomes its active text. */
export function placeSpanOnSelection(state: EditorState, spanId: string, selection: TextRange): ActionResult {
	const meta = spanMeta(state, spanId);
	if (!meta) return fail("Those versions are gone.");
	const doc = state.doc.toString();
	const range = trimRange(doc, selection);
	if (range.to <= range.from) return fail("Select the text these versions belong to.");
	const crossing = listSpans(state).find(
		(span) => span.meta.id !== spanId && span.range && span.range.from < range.to && range.from < span.range.to && !contains(span.range, range) && !contains(range, span.range),
	);
	if (crossing) return fail("That overlaps text that already has versions.");
	return {
		ok: true,
		spec: {
			effects: [
				setVersionText.of({ id: spanId, versionId: meta.activeVersion, text: doc.slice(range.from, range.to) }),
				placeSpan.of({ id: spanId, range }),
			],
			userEvent: VIKALP_EVENT.edit,
		},
	};
}

/** Dims the selection. Ghosts that touch it merge into one. */
export function ghostRange(state: EditorState, selection: TextRange): ActionResult {
	const doc = state.doc.toString();
	const trimmed = trimRange(doc, selection);
	if (trimmed.to <= trimmed.from) return fail("Select the text to ghost.");
	const touching = ghosts.list(state).filter((entry) => entry.range.to >= trimmed.from - 1 && entry.range.from <= trimmed.to + 1);
	const range = touching.reduce((union, entry) => ({ from: Math.min(union.from, entry.range.from), to: Math.max(union.to, entry.range.to) }), trimmed);
	const effects: StateEffect<unknown>[] = [];
	if (touching.length) effects.push(ghosts.effects.remove.of(touching.map((entry) => entry.meta.id)));
	effects.push(ghosts.effects.add.of([{ meta: { id: newId("gh"), createdAt: Date.now() }, range }]));
	return { ok: true, spec: { effects, userEvent: VIKALP_EVENT.ghost } };
}

/** Brings back ghosted text at the cursor or in the selection. */
export function reviveRange(state: EditorState, selection: TextRange): ActionResult<{ count: number }> {
	const found = selection.from === selection.to ? ghosts.at(state, selection.from) : ghosts.overlapping(state, selection);
	if (found.length === 0) return fail("No ghosted text here.");
	return {
		ok: true,
		count: found.length,
		spec: { effects: ghosts.effects.remove.of(found.map((entry) => entry.meta.id)), userEvent: VIKALP_EVENT.ghost },
	};
}

/** Deletes ranges of text and tidies the whitespace around each. */
export function deletionChanges(doc: string, ranges: TextRange[]): ChangeSpec[] {
	const sorted = [...ranges].sort((a, b) => a.from - b.from);
	const changes: TextRange[] = [];
	for (const range of sorted) {
		const tidy = tidyDeletion(doc, range);
		const last = changes[changes.length - 1];
		if (last && tidy.from <= last.to) last.to = Math.max(last.to, tidy.to);
		else changes.push({ ...tidy });
	}
	return changes.map((range) => ({ from: range.from, to: range.to }));
}

export function deleteAllGhosts(state: EditorState): ActionResult<{ count: number }> {
	const all = ghosts.list(state);
	if (all.length === 0) return fail("No ghosted text in this note.");
	return {
		ok: true,
		count: all.length,
		spec: {
			changes: deletionChanges(state.doc.toString(), all.map((entry) => entry.range)),
			effects: ghosts.effects.remove.of(all.map((entry) => entry.meta.id)),
			userEvent: VIKALP_EVENT.ghost,
		},
	};
}

/** Cuts the selection out of the note into the top of Overflow. */
export function stashRange(state: EditorState, selection: TextRange): ActionResult<{ blockId: string }> {
	const doc = state.doc.toString();
	const range = trimRange(doc, selection);
	if (range.to <= range.from) return fail("Select the text to stash.");
	const block = { id: newId("ov"), text: doc.slice(range.from, range.to), createdAt: Date.now() };
	return {
		ok: true,
		blockId: block.id,
		spec: {
			changes: deletionChanges(doc, [range]),
			effects: addOverflowBlock.of({ block, index: 0 }),
			userEvent: VIKALP_EVENT.stash,
		},
	};
}

/** Inserts an Overflow block at `position`. Removes it from Overflow unless `keepCopy`. */
export function insertOverflowBlock(state: EditorState, blockId: string, position: number, keepCopy: boolean): ActionResult {
	const block = state.field(overflowField).find((candidate) => candidate.id === blockId);
	if (!block) return fail("That block is gone.");
	const doc = state.doc.toString();
	const before = doc[position - 1] ?? "\n";
	const after = doc[position] ?? "\n";
	const isParagraph = /\n\s*\n/.test(block.text) || block.text.length > 200;
	let insert = block.text;
	if (isParagraph && before !== "\n") insert = `\n\n${insert}`;
	else if (!isParagraph && !/\s/.test(before)) insert = ` ${insert}`;
	if (isParagraph && after !== "\n") insert = `${insert}\n\n`;
	else if (!isParagraph && !/[\s.,;:!?]/.test(after)) insert = `${insert} `;
	const spec: TransactionSpec = {
		changes: { from: position, insert },
		selection: { anchor: position + insert.length },
		userEvent: VIKALP_EVENT.insert,
		scrollIntoView: true,
	};
	if (!keepCopy) spec.effects = removeOverflowBlock.of({ id: blockId });
	return { ok: true, spec };
}
