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
	return match && !/["“”]/.test(match[1]) ? match[1] : trimmed;
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

/**
 * Picks trim proposals in the model's order (most expendable first) until the
 * target word count is reached, so a "20%" trim lands near 20% even when the
 * model proposes more. Allows a 10% overshoot of the target.
 */
export function selectToTarget<Proposal extends { words: number; rank: number }>(proposals: Proposal[], targetWords: number): Proposal[] {
	const limit = Math.max(1, Math.round(targetWords * 1.1));
	const chosen: Proposal[] = [];
	let total = 0;
	for (const proposal of [...proposals].sort((a, b) => a.rank - b.rank)) {
		if (total + proposal.words > limit) continue;
		chosen.push(proposal);
		total += proposal.words;
		if (total >= targetWords) break;
	}
	return chosen;
}
