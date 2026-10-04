import { findQuote } from "../anchor/anchor";
import { isDuplicateVersion } from "../model/span";
import type { SpanMeta, TextRange } from "../model/types";
import type { NumberedSentence } from "./units";

export interface PlacedQuote<Extra> extends TextRange {
	extra: Extra;
}

/**
 * Finds each model quote in the note: first inside the sentence it claims to
 * come from, then anywhere. Quotes that can't be found verbatim are rejected,
 * and overlapping quotes keep the first.
 */
export function placeQuotes<Extra>(
	doc: string,
	sentences: NumberedSentence[],
	quotes: Array<{ unit_id?: string; quote: string; extra: Extra }>,
): { placed: PlacedQuote<Extra>[]; rejected: number } {
	const byId = new Map(sentences.map((sentence) => [sentence.id, sentence]));
	const placed: PlacedQuote<Extra>[] = [];
	let rejected = 0;
	for (const candidate of quotes) {
		const quote = stripWrappingQuotes(candidate.quote ?? "");
		const sentence = candidate.unit_id ? byId.get(candidate.unit_id) : undefined;
		const range = quote ? findQuote(doc, quote, sentence ? { within: sentence } : {}) : null;
		if (!range || placed.some((other) => other.from < range.to && range.from < other.to)) {
			rejected++;
			continue;
		}
		placed.push({ ...range, extra: candidate.extra });
	}
	placed.sort((a, b) => a.from - b.from);
	return { placed, rejected };
}

function stripWrappingQuotes(text: string): string {
	const trimmed = text.trim();
	const match = /^["“'‘](.*)["”'’]$/s.exec(trimmed);
	return match && !/["“”]/.test(match[1]!) ? match[1]! : trimmed;
}

/** Cleans AI alternatives: trims, drops empties and duplicates of existing versions, caps the count. */
export function acceptableAlternatives(span: SpanMeta, candidates: string[], cap: number): string[] {
	const accepted: string[] = [];
	let working = span;
	for (const raw of candidates) {
		const text = raw.replace(/^[-*•\d.)\s]+(?=\S)/, "").replace(/^["“](.*)["”]$/s, "$1").trim();
		if (!text || isDuplicateVersion(working, text)) continue;
		accepted.push(text);
		working = { ...working, versions: [...working.versions, { id: "", text, source: "ai", createdAt: 0 }] };
		if (accepted.length >= cap) break;
	}
	return accepted;
}
