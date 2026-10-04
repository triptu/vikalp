import { invertedEffects } from "@codemirror/commands";
import { StateEffect, StateField, type EditorState, type Extension, type Transaction } from "@codemirror/state";
import { makeAnchor, resolveAnchor } from "../core/anchor/anchor";
import type { TextRange } from "../core/model/types";
import { allRanges, mapAndFindLost, rangeOf, rangeSetFrom, withRange, withoutIds, type IdRangeSet } from "./ranges";
import { isUserEdit, mapRange } from "./transactions";

export interface RangeCollectionValue<Meta extends { id: string }> {
	ranges: IdRangeSet;
	meta: ReadonlyMap<string, Meta>;
}

export interface RangeEntry<Meta> {
	meta: Meta;
	range: TextRange;
}

/**
 * A set of id-tagged ranges with metadata that follow the text as it changes.
 * Used for ghosts, lint hits and trim proposals. When `undoable` is set, adding
 * and removing entries is part of the undo history.
 */
export function createRangeCollection<Meta extends { id: string }>(options: { undoable: boolean }) {
	const add = StateEffect.define<RangeEntry<Meta>[]>({
		map: (entries, mapping) => entries.map((entry) => ({ ...entry, range: mapRange(entry.range, mapping) })),
	});
	const remove = StateEffect.define<string[]>();
	const replaceAll = StateEffect.define<RangeEntry<Meta>[]>();
	const updateMeta = StateEffect.define<Meta>();

	const empty: RangeCollectionValue<Meta> = { ranges: rangeSetFrom([]), meta: new Map() };

	const field = StateField.define<RangeCollectionValue<Meta>>({
		create: () => empty,
		update(value, tr) {
			const { mapped, lost } = mapAndFindLost(value.ranges, tr.changes);
			let ranges = mapped;
			let meta = value.meta;
			if (lost.size > 0) ({ ranges, meta } = handleLost(value, { ranges, meta }, lost, tr));
			for (const effect of tr.effects) {
				if (effect.is(replaceAll)) {
					const valid = effect.value.filter((entry) => entry.range.from >= 0 && entry.range.to <= tr.newDoc.length);
					ranges = rangeSetFrom(valid.map((entry) => ({ id: entry.meta.id, range: entry.range })));
					meta = new Map(valid.map((entry) => [entry.meta.id, entry.meta]));
				} else if (effect.is(add)) {
					const nextMeta = new Map(meta);
					for (const entry of effect.value) {
						if (entry.range.to > tr.newDoc.length || entry.range.from < 0) continue;
						ranges = withRange(ranges, entry.meta.id, entry.range);
						nextMeta.set(entry.meta.id, entry.meta);
					}
					meta = nextMeta;
				} else if (effect.is(remove)) {
					const ids = new Set(effect.value);
					ranges = withoutIds(ranges, ids);
					meta = new Map([...meta].filter(([id]) => !ids.has(id)));
				} else if (effect.is(updateMeta) && meta.has(effect.value.id)) {
					meta = new Map(meta).set(effect.value.id, effect.value);
				}
			}
			if (ranges === value.ranges && meta === value.meta) return value;
			return { ranges, meta };
		},
	});

	function handleLost(
		previous: RangeCollectionValue<Meta>,
		current: RangeCollectionValue<Meta>,
		lost: Set<string>,
		tr: Transaction,
	): RangeCollectionValue<Meta> {
		const meta = new Map(current.meta);
		let ranges = current.ranges;
		if (isUserEdit(tr)) {
			for (const id of lost) meta.delete(id);
			return { ranges, meta };
		}
		const startDoc = tr.startState.doc.toString();
		const newDoc = tr.state.doc.toString();
		for (const id of lost) {
			const oldRange = rangeOf(previous.ranges, id);
			const found = oldRange ? resolveAnchor(newDoc, makeAnchor(startDoc, oldRange)) : null;
			if (found) ranges = withRange(ranges, id, found);
			else meta.delete(id);
		}
		return { ranges, meta };
	}

	const extensions: Extension[] = [field];
	if (options.undoable) {
		extensions.push(
			invertedEffects.of((tr) => {
				const start = tr.startState.field(field, false);
				if (!start) return [];
				const inverses: StateEffect<unknown>[] = [];
				const explicitlyRemoved = new Set<string>();
				for (const effect of tr.effects) {
					if (effect.is(add)) inverses.push(remove.of(effect.value.map((entry) => entry.meta.id)));
					else if (effect.is(remove)) {
						const restored = effect.value.flatMap((id) => {
							explicitlyRemoved.add(id);
							const meta = start.meta.get(id);
							const range = rangeOf(start.ranges, id);
							return meta && range ? [{ meta, range }] : [];
						});
						if (restored.length) inverses.push(add.of(restored));
					}
				}
				if (!tr.changes.empty) {
					const end = tr.state.field(field);
					const dropped = [...start.meta.keys()]
						.filter((id) => !end.meta.has(id) && !explicitlyRemoved.has(id))
						.flatMap((id) => {
							const range = rangeOf(start.ranges, id);
							return range ? [{ meta: start.meta.get(id)!, range }] : [];
						});
					if (dropped.length) inverses.push(add.of(dropped));
				}
				return inverses;
			}),
		);
	}

	function list(state: EditorState): Array<RangeEntry<Meta>> {
		const value = state.field(field, false) ?? empty;
		const ranges = allRanges(value.ranges);
		return [...value.meta.values()]
			.flatMap((meta) => {
				const range = ranges.get(meta.id);
				return range ? [{ meta, range }] : [];
			})
			.sort((a, b) => a.range.from - b.range.from);
	}

	function at(state: EditorState, position: number): Array<RangeEntry<Meta>> {
		const value = state.field(field, false) ?? empty;
		const found: Array<RangeEntry<Meta>> = [];
		value.ranges.between(position, position, (from, to, range) => {
			const meta = value.meta.get(range.id);
			if (meta && from <= position && position <= to) found.push({ meta, range: { from, to } });
		});
		return found;
	}

	function overlapping(state: EditorState, range: TextRange): Array<RangeEntry<Meta>> {
		const value = state.field(field, false) ?? empty;
		const found: Array<RangeEntry<Meta>> = [];
		value.ranges.between(range.from, range.to, (from, to, idRange) => {
			const meta = value.meta.get(idRange.id);
			if (meta && from < range.to && range.from < to) found.push({ meta, range: { from, to } });
		});
		return found;
	}

	return { field, extensions, effects: { add, remove, replaceAll, updateMeta }, list, at, overlapping, empty };
}
