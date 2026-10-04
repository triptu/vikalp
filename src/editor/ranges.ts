import { RangeSet, RangeValue, type ChangeDesc, type Range } from "@codemirror/state";
import type { TextRange } from "../core/model/types";

/** A range tagged with an id. Edges are exclusive: typing at either edge stays outside. */
export class IdRange extends RangeValue {
	override startSide = 1;
	override endSide = -1;

	constructor(readonly id: string) {
		super();
	}

	override eq(other: RangeValue): boolean {
		return other instanceof IdRange && other.id === this.id;
	}
}

export type IdRangeSet = RangeSet<IdRange>;

export function rangeOf(set: IdRangeSet, id: string): TextRange | null {
	let found: TextRange | null = null;
	set.between(0, Number.MAX_SAFE_INTEGER, (from, to, value) => {
		if (value.id === id) {
			found = { from, to };
			return false;
		}
		return undefined;
	});
	return found;
}

export function allRanges(set: IdRangeSet): Map<string, TextRange> {
	const ranges = new Map<string, TextRange>();
	for (let cursor = set.iter(); cursor.value; cursor.next()) ranges.set(cursor.value.id, { from: cursor.from, to: cursor.to });
	return ranges;
}

export function withRange(set: IdRangeSet, id: string, range: TextRange | null): IdRangeSet {
	const without = set.update({ filter: (_from, _to, value) => value.id !== id });
	if (!range || range.to <= range.from) return without;
	return without.update({ add: [new IdRange(id).range(range.from, range.to)] });
}

export function withoutIds(set: IdRangeSet, ids: Set<string>): IdRangeSet {
	if (ids.size === 0) return set;
	return set.update({ filter: (_from, _to, value) => !ids.has(value.id) });
}

export function rangeSetFrom(entries: Array<{ id: string; range: TextRange }>): IdRangeSet {
	const ranges: Range<IdRange>[] = entries
		.filter((entry) => entry.range.to > entry.range.from)
		.map((entry) => new IdRange(entry.id).range(entry.range.from, entry.range.to));
	return RangeSet.of(ranges, true);
}

/** Maps a set through changes and reports which ids collapsed or were deleted. */
export function mapAndFindLost(set: IdRangeSet, changes: ChangeDesc): { mapped: IdRangeSet; lost: Set<string> } {
	if (changes.empty) return { mapped: set, lost: new Set() };
	const before = new Set<string>();
	for (let cursor = set.iter(); cursor.value; cursor.next()) before.add(cursor.value.id);
	const mapped = set.map(changes);
	for (let cursor = mapped.iter(); cursor.value; cursor.next()) before.delete(cursor.value.id);
	return { mapped, lost: before };
}

/** Ids whose ranges sit fully inside `outer`. */
export function idsInside(set: IdRangeSet, outer: TextRange, exceptId?: string): Array<{ id: string; range: TextRange }> {
	const inside: Array<{ id: string; range: TextRange }> = [];
	set.between(outer.from, outer.to, (from, to, value) => {
		if (value.id !== exceptId && from >= outer.from && to <= outer.to) inside.push({ id: value.id, range: { from, to } });
	});
	return inside;
}
