import { invertedEffects } from "@codemirror/commands";
import { StateEffect, StateField, type EditorState, type Transaction } from "@codemirror/state";
import { makeAnchor, resolveAnchor } from "../core/anchor/anchor";
import type { SpanMeta, TextRange, Version } from "../core/model/types";
import { allRanges, mapAndFindLost, rangeOf, rangeSetFrom, withRange, type IdRangeSet } from "./ranges";
import { isUserEdit, mapRange } from "./transactions";

/** All alternatives in one editor: where each span is, and its versions. */
export interface SpansValue {
	ranges: IdRangeSet;
	meta: ReadonlyMap<string, SpanMeta>;
}

export interface SpanPlacement {
	id: string;
	range: TextRange | null;
	hiddenIn?: string;
	orphaned?: boolean;
	lastText?: string;
}

const mapOptionalRange = <T extends { range: TextRange | null }>(value: T, mapping: Parameters<typeof mapRange>[1]): T => ({
	...value,
	range: value.range ? mapRange(value.range, mapping) : null,
});

export const createSpan = StateEffect.define<{ meta: SpanMeta; range: TextRange | null }>({ map: mapOptionalRange });
export const removeSpan = StateEffect.define<{ id: string }>();
export const setActiveVersion = StateEffect.define<{ id: string; versionId: string; range: TextRange | null }>({ map: mapOptionalRange });
export const setVersionText = StateEffect.define<{ id: string; versionId: string; text: string }>();
export const addVersion = StateEffect.define<{ id: string; version: Version; index?: number }>();
export const deleteVersion = StateEffect.define<{ id: string; versionId: string }>();
export const setSpanNote = StateEffect.define<{ id: string; note: string }>();
export const placeSpan = StateEffect.define<SpanPlacement>({ map: mapOptionalRange });
export const loadSpans = StateEffect.define<Array<{ meta: SpanMeta; range: TextRange | null }>>();

const EMPTY: SpansValue = { ranges: rangeSetFrom([]), meta: new Map() };

export const spansField = StateField.define<SpansValue>({
	create: () => EMPTY,
	update(value, tr) {
		const { mapped, lost } = mapAndFindLost(value.ranges, tr.changes);
		let next: SpansValue = mapped === value.ranges ? value : { ranges: mapped, meta: value.meta };
		const touched = new Set<string>();
		for (const effect of tr.effects) {
			const result = applySpanEffect(next, clampEffect(effect, tr.newDoc.length));
			if (result) {
				next = result.value;
				if (result.id) touched.add(result.id);
			}
		}
		const untouchedLost = [...lost].filter((id) => !touched.has(id) && next.meta.has(id));
		if (untouchedLost.length > 0) next = handleLostSpans(next, untouchedLost, tr, value);
		if (next.meta !== value.meta) next = orphanChildrenOfMissingParents(next);
		return next;
	},
	provide: (field) =>
		invertedEffects.of((tr) => invertSpanEffects(tr.startState.field(field), tr.state.field(field), tr)),
});

/** Drops ranges that point past the end of the document, so a stale effect can't break the editor. */
function clampEffect(effect: StateEffect<unknown>, docLength: number): StateEffect<unknown> {
	const value = effect.value as { range?: TextRange | null } | undefined;
	const range = value && typeof value === "object" && "range" in value ? value.range : undefined;
	if (!range || (range.from >= 0 && range.to <= docLength)) return effect;
	if (effect.is(createSpan)) return createSpan.of({ ...effect.value, range: null });
	if (effect.is(setActiveVersion)) return setActiveVersion.of({ ...effect.value, range: null });
	if (effect.is(placeSpan)) return placeSpan.of({ ...effect.value, range: null, orphaned: true });
	return effect;
}

function applySpanEffect(value: SpansValue, effect: StateEffect<unknown>): { value: SpansValue; id?: string } | null {
	if (effect.is(loadSpans)) {
		const meta = new Map(effect.value.map((entry) => [entry.meta.id, entry.meta]));
		const ranges = rangeSetFrom(effect.value.filter((entry) => entry.range).map((entry) => ({ id: entry.meta.id, range: entry.range! })));
		return { value: { ranges, meta } };
	}
	if (effect.is(createSpan)) {
		const { meta, range } = effect.value;
		return { value: { ranges: withRange(value.ranges, meta.id, range), meta: withMeta(value.meta, meta) }, id: meta.id };
	}
	if (effect.is(removeSpan)) {
		const meta = new Map(value.meta);
		meta.delete(effect.value.id);
		return { value: { ranges: withRange(value.ranges, effect.value.id, null), meta }, id: effect.value.id };
	}
	const id = (effect.value as { id?: string } | undefined)?.id;
	const span = id ? value.meta.get(id) : undefined;
	if (!span || !id) return null;

	if (effect.is(setActiveVersion)) {
		const { versionId, range } = effect.value;
		const ranges = range ? withRange(value.ranges, id, range) : value.ranges;
		return { value: { ranges, meta: withMeta(value.meta, { ...span, activeVersion: versionId }) }, id };
	}
	if (effect.is(setVersionText)) {
		const versions = span.versions.map((version) => (version.id === effect.value.versionId ? { ...version, text: effect.value.text } : version));
		return { value: { ranges: value.ranges, meta: withMeta(value.meta, { ...span, versions }) } };
	}
	if (effect.is(addVersion)) {
		const versions = [...span.versions];
		versions.splice(effect.value.index ?? versions.length, 0, effect.value.version);
		return { value: { ranges: value.ranges, meta: withMeta(value.meta, { ...span, versions }) } };
	}
	if (effect.is(deleteVersion)) {
		const versions = span.versions.filter((version) => version.id !== effect.value.versionId);
		return { value: { ranges: value.ranges, meta: withMeta(value.meta, { ...span, versions }) } };
	}
	if (effect.is(setSpanNote)) {
		const note = effect.value.note.trim();
		const updated: SpanMeta = { ...span };
		if (note) updated.note = effect.value.note;
		else delete updated.note;
		return { value: { ranges: value.ranges, meta: withMeta(value.meta, updated) } };
	}
	if (effect.is(placeSpan)) {
		const { range, hiddenIn, orphaned, lastText } = effect.value;
		const updated: SpanMeta = { ...span };
		delete updated.hiddenIn;
		delete updated.orphaned;
		delete updated.lastText;
		if (hiddenIn) updated.hiddenIn = hiddenIn;
		if (orphaned) updated.orphaned = true;
		if (lastText !== undefined) updated.lastText = lastText;
		return { value: { ranges: withRange(value.ranges, id, range), meta: withMeta(value.meta, updated) }, id };
	}
	return null;
}

function withMeta(meta: ReadonlyMap<string, SpanMeta>, span: SpanMeta): Map<string, SpanMeta> {
	const next = new Map(meta);
	next.set(span.id, span);
	return next;
}

/**
 * A span whose text was deleted by the user goes away (undo brings it back).
 * When text vanishes for another reason, such as the file being reloaded from
 * disk, the span is re-anchored by its text, or kept as an orphan.
 */
function handleLostSpans(value: SpansValue, lostIds: string[], tr: Transaction, previous: SpansValue): SpansValue {
	const meta = new Map(value.meta);
	let ranges = value.ranges;
	const userEdit = isUserEdit(tr);
	const startDoc = tr.startState.doc.toString();
	const newDoc = userEdit ? "" : tr.state.doc.toString();
	for (const id of lostIds) {
		if (userEdit) {
			meta.delete(id);
			continue;
		}
		const oldRange = rangeOf(previous.ranges, id);
		const span = meta.get(id);
		if (!oldRange || !span) continue;
		const anchor = makeAnchor(startDoc, oldRange);
		const found = resolveAnchor(newDoc, anchor);
		if (found) ranges = withRange(ranges, id, found);
		else meta.set(id, { ...span, orphaned: true, lastText: anchor.exact });
	}
	return { ranges, meta };
}

/** A span hidden inside a paragraph version can only come back through its parent. If the parent is gone, list it as unplaced. */
function orphanChildrenOfMissingParents(value: SpansValue): SpansValue {
	let meta: Map<string, SpanMeta> | null = null;
	for (const span of value.meta.values()) {
		if (!span.hiddenIn || value.meta.has(span.hiddenIn)) continue;
		meta ??= new Map(value.meta);
		const orphan: SpanMeta = { ...span, orphaned: true };
		delete orphan.hiddenIn;
		meta.set(span.id, orphan);
	}
	return meta ? { ranges: value.ranges, meta } : value;
}

function invertSpanEffects(start: SpansValue, end: SpansValue, tr: Transaction): readonly StateEffect<unknown>[] {
	if (start === end) return [];
	const inverses: StateEffect<unknown>[] = [];
	const explicitlyRemoved = new Set<string>();
	for (const effect of tr.effects) {
		if (effect.is(createSpan)) inverses.push(removeSpan.of({ id: effect.value.meta.id }));
		else if (effect.is(removeSpan)) {
			explicitlyRemoved.add(effect.value.id);
			const meta = start.meta.get(effect.value.id);
			if (meta) inverses.push(createSpan.of({ meta, range: rangeOf(start.ranges, meta.id) }));
		} else if (effect.is(setActiveVersion)) {
			const meta = start.meta.get(effect.value.id);
			if (meta) inverses.push(setActiveVersion.of({ id: meta.id, versionId: meta.activeVersion, range: rangeOf(start.ranges, meta.id) }));
		} else if (effect.is(setVersionText)) {
			const previousText = start.meta.get(effect.value.id)?.versions.find((version) => version.id === effect.value.versionId)?.text;
			if (previousText !== undefined) inverses.push(setVersionText.of({ ...effect.value, text: previousText }));
		} else if (effect.is(addVersion)) {
			inverses.push(deleteVersion.of({ id: effect.value.id, versionId: effect.value.version.id }));
		} else if (effect.is(deleteVersion)) {
			const meta = start.meta.get(effect.value.id);
			const index = meta?.versions.findIndex((version) => version.id === effect.value.versionId) ?? -1;
			if (meta && index !== -1) inverses.push(addVersion.of({ id: meta.id, version: meta.versions[index]!, index }));
		} else if (effect.is(setSpanNote)) {
			const meta = start.meta.get(effect.value.id);
			if (meta) inverses.push(setSpanNote.of({ id: meta.id, note: meta.note ?? "" }));
		} else if (effect.is(placeSpan)) {
			const meta = start.meta.get(effect.value.id);
			if (meta) {
				inverses.push(
					placeSpan.of({ id: meta.id, range: rangeOf(start.ranges, meta.id), hiddenIn: meta.hiddenIn, orphaned: meta.orphaned, lastText: meta.lastText }),
				);
			}
		}
	}
	for (const [id, meta] of start.meta) {
		if (!end.meta.has(id) && !explicitlyRemoved.has(id)) inverses.push(createSpan.of({ meta, range: rangeOf(start.ranges, id) }));
	}
	return inverses;
}

/** Spans with their current ranges, in document order; unplaced spans last. */
export function listSpans(state: EditorState): Array<{ meta: SpanMeta; range: TextRange | null }> {
	const value = state.field(spansField, false) ?? EMPTY;
	const ranges = allRanges(value.ranges);
	return [...value.meta.values()]
		.map((meta) => ({ meta, range: ranges.get(meta.id) ?? null }))
		.sort((a, b) => (a.range?.from ?? Infinity) - (b.range?.from ?? Infinity));
}

export function spanRange(state: EditorState, id: string): TextRange | null {
	const value = state.field(spansField, false);
	return value ? rangeOf(value.ranges, id) : null;
}

export function spanMeta(state: EditorState, id: string): SpanMeta | undefined {
	return state.field(spansField, false)?.meta.get(id);
}

/** The innermost placed span containing `position` (edges included). */
export function spanAt(state: EditorState, position: number): string | null {
	const value = state.field(spansField, false);
	if (!value) return null;
	let best: { id: string; size: number } | null = null;
	value.ranges.between(position, position, (from, to, range) => {
		if (from <= position && position <= to && (!best || to - from < best.size)) best = { id: range.id, size: to - from };
	});
	return (best as { id: string } | null)?.id ?? null;
}
