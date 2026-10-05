import type { TextRange } from "../model/types";
import { mergeRanges } from "./markdown";
import { countWords } from "./segment";

/**
 * Widens a deletion so removing it leaves tidy text: one space between words,
 * no space before punctuation, and no leftover blank lines when whole lines go.
 */
export function tidyDeletion(doc: string, range: TextRange): TextRange {
	let { from, to } = range;
	const lineStart = doc.lastIndexOf("\n", from - 1) + 1;
	const lineEndIndex = doc.indexOf("\n", to);
	const lineEnd = lineEndIndex === -1 ? doc.length : lineEndIndex;
	const restOfLineBefore = doc.slice(lineStart, from);
	const restOfLineAfter = doc.slice(to, lineEnd);

	if (restOfLineBefore.trim() === "" && restOfLineAfter.trim() === "") {
		from = lineStart;
		to = lineEnd;
		if (doc[to] === "\n") {
			to++;
			if (doc[to] === "\n" && (from === 0 || doc[from - 1] === "\n")) to++;
		} else if (from > 0 && doc[from - 1] === "\n") {
			from--;
			if (from > 0 && doc[from - 1] === "\n") from--;
		}
		return { from, to };
	}

	const charBefore = doc[from - 1] ?? "\n";
	const charAfter = doc[to] ?? "\n";
	if (charBefore === " " && (charAfter === " " || /[.,;:!?)\]]/.test(charAfter) || charAfter === "\n")) from--;
	else if (charAfter === " " && (charBefore === "\n" || /[(["“]/.test(charBefore))) to++;
	return { from, to };
}

/** The note with the given ranges (ghosts) removed and whitespace tidied. */
export function removeRanges(doc: string, ranges: TextRange[], within: TextRange = { from: 0, to: doc.length }): string {
	const clipped = mergeRanges(
		ranges
			.map((range) => ({ from: Math.max(range.from, within.from), to: Math.min(range.to, within.to) }))
			.filter((range) => range.to > range.from),
	);
	let text = doc.slice(within.from, within.to);
	for (const range of [...clipped].reverse()) {
		const local = { from: range.from - within.from, to: range.to - within.from };
		const tidy = tidyDeletion(text, local);
		text = text.slice(0, tidy.from) + text.slice(tidy.to);
	}
	return text.replace(/\n{3,}/g, "\n\n");
}

/** Word count of the text outside the given ranges, and the words inside them. */
export function countVisibleWords(doc: string, hidden: TextRange[]): { visible: number; hidden: number } {
	const merged = mergeRanges(hidden);
	const hiddenWords = merged.reduce((sum, range) => sum + countWords(doc.slice(range.from, range.to)), 0);
	return { visible: countWords(doc) - hiddenWords, hidden: hiddenWords };
}
