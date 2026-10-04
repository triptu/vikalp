import type { SpanUnit, TextRange } from "../model/types";
import { findBlocks, type Block } from "./markdown";

const ABBREVIATIONS = new Set([
	"mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "eg", "ie", "cf", "al",
	"inc", "ltd", "co", "corp", "fig", "no", "vol", "approx", "dept", "est", "jan", "feb", "mar", "apr",
	"jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "u.s", "u.k", "a.m", "p.m",
]);

const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });

/** Sentence ranges within `text`, offset by `base`. Trailing whitespace is excluded. */
export function findSentences(text: string, base = 0): TextRange[] {
	const raw: TextRange[] = [];
	for (const segment of sentenceSegmenter.segment(text)) {
		raw.push({ from: segment.index, to: segment.index + segment.segment.length });
	}
	const merged: TextRange[] = [];
	for (const range of raw) {
		const previous = merged[merged.length - 1];
		if (previous && endsWithAbbreviation(text.slice(previous.from, previous.to))) previous.to = range.to;
		else merged.push({ ...range });
	}
	return merged
		.map((range) => trimRange(text, range))
		.filter((range) => range.to > range.from)
		.map((range) => ({ from: range.from + base, to: range.to + base }));
}

function endsWithAbbreviation(sentence: string): boolean {
	const lastWord = /([A-Za-z.]+)\.\s*$/.exec(sentence)?.[1];
	if (!lastWord) return false;
	if (/^[A-Z]$/.test(lastWord)) return true;
	return ABBREVIATIONS.has(lastWord.toLowerCase());
}

export function trimRange(text: string, range: TextRange): TextRange {
	let { from, to } = range;
	while (from < to && /\s/.test(text[from] ?? "")) from++;
	while (to > from && /\s/.test(text[to - 1] ?? "")) to--;
	return { from, to };
}

export interface ParagraphUnit extends Block {
	sentences: TextRange[];
}

/** Every prose paragraph in the note with its sentences, in document order. */
export function segmentNote(doc: string): ParagraphUnit[] {
	return findBlocks(doc).map((block) => ({
		...block,
		sentences: block.kind === "heading" ? [{ from: block.from, to: block.to }] : findSentences(doc.slice(block.from, block.to), block.from),
	}));
}

export function words(text: string): string[] {
	const found: string[] = [];
	for (const segment of wordSegmenter.segment(text)) {
		if (segment.isWordLike) found.push(segment.segment);
	}
	return found;
}

export function countWords(text: string): number {
	let count = 0;
	for (const segment of wordSegmenter.segment(text)) {
		if (segment.isWordLike) count++;
	}
	return count;
}

const WORD_CHAR = /[\p{L}\p{N}'’_-]/u;

/** Grows a selection that cuts through a word to cover the whole word, then trims whitespace. */
export function expandToWords(doc: string, range: TextRange): TextRange {
	let { from, to } = trimRange(doc, range);
	if (from === to) {
		while (from > 0 && WORD_CHAR.test(doc[from - 1] ?? "")) from--;
		while (to < doc.length && WORD_CHAR.test(doc[to] ?? "")) to++;
		return { from, to };
	}
	if (WORD_CHAR.test(doc[from] ?? "")) {
		while (from > 0 && WORD_CHAR.test(doc[from - 1] ?? "")) from--;
	}
	if (WORD_CHAR.test(doc[to - 1] ?? "")) {
		while (to < doc.length && WORD_CHAR.test(doc[to] ?? "")) to++;
	}
	return { from, to };
}

/**
 * Turns a raw selection into the range a new span should cover: whole words,
 * no outer whitespace, trailing punctuation kept only for sentences and paragraphs.
 */
export function normalizeSpanRange(doc: string, selection: TextRange): { range: TextRange; unit: SpanUnit } {
	const expanded = expandToWords(doc, selection);
	const unit = classifyUnit(doc, expanded);
	if (unit !== "word") return { range: expanded, unit };
	let { from, to } = expanded;
	while (to > from + 1 && /[.,;:!?)"”’]/.test(doc[to - 1] ?? "")) to--;
	while (from < to - 1 && /[("“‘]/.test(doc[from] ?? "")) from++;
	const trimmed = { from, to };
	return { range: trimmed, unit: classifyUnit(doc, trimmed) };
}

export function sentenceAround(doc: string, range: TextRange): TextRange | null {
	const paragraph = paragraphAround(doc, range);
	if (!paragraph) return null;
	const sentences = segmentNote(doc).find((unit) => unit.from === paragraph.from)?.sentences ?? [];
	const first = sentences.find((sentence) => sentence.from <= range.from && range.from <= sentence.to);
	const last = [...sentences].reverse().find((sentence) => sentence.from <= range.to && range.to <= sentence.to);
	if (!first || !last) return null;
	return { from: first.from, to: last.to };
}

export function paragraphAround(doc: string, range: TextRange): TextRange | null {
	const blocks = findBlocks(doc);
	const first = blocks.find((block) => block.from <= range.from && range.from <= block.to);
	const last = blocks.find((block) => block.from <= range.to && range.to <= block.to);
	if (!first || !last) return null;
	return { from: first.from, to: last.to };
}

/** Expands a selection to the given unit: whole words, whole sentences or whole paragraphs. */
export function expandToUnit(doc: string, range: TextRange, unit: SpanUnit): TextRange | null {
	if (unit === "word") return expandToWords(doc, range);
	if (unit === "sentence") return sentenceAround(doc, range);
	return paragraphAround(doc, range);
}

/** Labels a range by size: a whole block is a paragraph, a whole sentence or heading is a sentence. */
export function classifyUnit(doc: string, range: TextRange): SpanUnit {
	const block = findBlocks(doc).find((candidate) => candidate.from <= range.from && range.to <= candidate.to);
	if (!block) return "word";
	if (block.from === range.from && block.to === range.to) {
		if (block.kind === "heading") return "sentence";
		const sentenceCount = findSentences(doc.slice(block.from, block.to)).length;
		return sentenceCount > 1 ? "paragraph" : "sentence";
	}
	const sentences = findSentences(doc.slice(block.from, block.to), block.from);
	const coversSentences = sentences.some((sentence) => sentence.from === range.from) && sentences.some((sentence) => sentence.to === range.to);
	return coversSentences ? "sentence" : "word";
}
