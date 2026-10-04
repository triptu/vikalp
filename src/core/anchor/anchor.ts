import search from "approx-string-match";
import type { Anchor, TextRange } from "../model/types";

const CONTEXT_LENGTH = 32;
const MAX_FUZZY_ERROR_RATIO = 0.2;
const FUZZY_TEXT_LIMIT = 200_000;

export function makeAnchor(doc: string, range: TextRange): Anchor {
	return {
		start: range.from,
		end: range.to,
		exact: doc.slice(range.from, range.to),
		prefix: doc.slice(Math.max(0, range.from - CONTEXT_LENGTH), range.from),
		suffix: doc.slice(range.to, range.to + CONTEXT_LENGTH),
	};
}

/**
 * Finds where an anchor sits in `doc` now. Tries the stored position, then
 * exact matches near it (scored by surrounding context), then a fuzzy match
 * allowing up to 20% edits. Returns null rather than guess between ties.
 */
export function resolveAnchor(doc: string, anchor: Anchor): TextRange | null {
	const { exact } = anchor;
	if (exact === "") return null;
	if (doc.slice(anchor.start, anchor.end) === exact) return { from: anchor.start, to: anchor.end };

	for (const radius of [200, 2000, Infinity]) {
		const windowFrom = Math.max(0, anchor.start - radius);
		const windowTo = Math.min(doc.length, anchor.end + radius);
		const hits = allIndexesOf(doc, exact, windowFrom, windowTo);
		if (hits.length === 1) return { from: hits[0]!, to: hits[0]! + exact.length };
		if (hits.length > 1) return pickByContext(doc, anchor, hits);
	}
	return fuzzyResolve(doc, anchor);
}

function allIndexesOf(doc: string, needle: string, from: number, to: number): number[] {
	const hits: number[] = [];
	let index = doc.indexOf(needle, from);
	while (index !== -1 && index + needle.length <= to) {
		hits.push(index);
		index = doc.indexOf(needle, index + 1);
	}
	return hits;
}

function pickByContext(doc: string, anchor: Anchor, hits: number[]): TextRange | null {
	const scored = hits.map((index) => ({
		index,
		score:
			commonSuffixLength(doc.slice(Math.max(0, index - CONTEXT_LENGTH), index), anchor.prefix) +
			commonPrefixLength(doc.slice(index + anchor.exact.length, index + anchor.exact.length + CONTEXT_LENGTH), anchor.suffix),
		distance: Math.abs(index - anchor.start),
	}));
	scored.sort((a, b) => b.score - a.score || a.distance - b.distance);
	const [best, runnerUp] = scored;
	if (!best) return null;
	if (runnerUp && runnerUp.score === best.score && best.score === 0 && runnerUp.distance === best.distance) return null;
	return { from: best.index, to: best.index + anchor.exact.length };
}

function commonPrefixLength(a: string, b: string): number {
	let length = 0;
	while (length < a.length && length < b.length && a[length] === b[length]) length++;
	return length;
}

function commonSuffixLength(a: string, b: string): number {
	let length = 0;
	while (length < a.length && length < b.length && a[a.length - 1 - length] === b[b.length - 1 - length]) length++;
	return length;
}

function fuzzyResolve(doc: string, anchor: Anchor): TextRange | null {
	const { exact } = anchor;
	if (exact.length < 4 || exact.length > 32 * 64 || doc.length > FUZZY_TEXT_LIMIT) return null;
	const maxErrors = Math.floor(exact.length * MAX_FUZZY_ERROR_RATIO);
	const matches = search(doc, exact, maxErrors);
	if (matches.length === 0) return null;
	const bestErrors = Math.min(...matches.map((match) => match.errors));
	const best = matches.filter((match) => match.errors === bestErrors);
	const distinctStarts = new Set(best.map((match) => match.start));
	if (distinctStarts.size > 1) {
		const withContext = best.map((match) => ({
			match,
			score:
				commonSuffixLength(doc.slice(Math.max(0, match.start - CONTEXT_LENGTH), match.start), anchor.prefix) +
				commonPrefixLength(doc.slice(match.end, match.end + CONTEXT_LENGTH), anchor.suffix),
		}));
		withContext.sort((a, b) => b.score - a.score);
		if (withContext[0]!.score === withContext[1]!.score) return null;
		return { from: withContext[0]!.match.start, to: withContext[0]!.match.end };
	}
	const chosen = best.reduce((longest, match) => (match.end - match.start > longest.end - longest.start ? match : longest));
	return { from: chosen.start, to: chosen.end };
}

/**
 * Finds a quote returned by a model. Exact match inside the hint range first,
 * then anywhere; `before` (a few words preceding the quote) breaks ties.
 */
export function findQuote(doc: string, quote: string, options: { within?: TextRange; before?: string } = {}): TextRange | null {
	const needle = quote.trim();
	if (needle === "") return null;
	const scopes: TextRange[] = options.within ? [options.within, { from: 0, to: doc.length }] : [{ from: 0, to: doc.length }];
	for (const scope of scopes) {
		const hits = allIndexesOf(doc, needle, scope.from, scope.to);
		if (hits.length === 1) return { from: hits[0]!, to: hits[0]! + needle.length };
		if (hits.length > 1) {
			const before = options.before?.trim() ?? "";
			const preferred = before
				? hits.find((index) => doc.slice(Math.max(0, index - before.length - 2), index).includes(before))
				: undefined;
			const chosen = preferred ?? hits[0]!;
			return { from: chosen, to: chosen + needle.length };
		}
	}
	const normalized = findIgnoringQuoteStyle(doc, needle, options.within);
	return normalized;
}

/** Models often swap curly and straight quotes or dashes. Match those loosely. */
function findIgnoringQuoteStyle(doc: string, needle: string, within?: TextRange): TextRange | null {
	const fold = (text: string) => text.replace(/[‘’‛′]/g, "'").replace(/[“”„″]/g, '"').replace(/[–—]/g, "-");
	const foldedDoc = fold(doc);
	const foldedNeedle = fold(needle);
	if (foldedDoc.length !== doc.length || foldedNeedle.length !== needle.length) return null;
	const scope = within ?? { from: 0, to: doc.length };
	let index = foldedDoc.indexOf(foldedNeedle, scope.from);
	if (index === -1 || index + needle.length > scope.to) index = foldedDoc.indexOf(foldedNeedle);
	if (index === -1) return null;
	return { from: index, to: index + needle.length };
}
