import type { TextRange } from "../model/types";
import { segmentNote } from "../text/segment";

export interface NumberedSentence extends TextRange {
	id: string;
	text: string;
	paragraphIndex: number;
}

/**
 * Splits a note into sentences with short ids (`s1`, `s2`, …) so a model can
 * point at text by id plus exact quote instead of by character offsets.
 */
export function numberSentences(doc: string, skip: TextRange[] = []): NumberedSentence[] {
	const sentences: NumberedSentence[] = [];
	segmentNote(doc).forEach((paragraph, paragraphIndex) => {
		for (const sentence of paragraph.sentences) {
			if (skip.some((range) => range.from <= sentence.from && sentence.to <= range.to)) continue;
			sentences.push({ id: `s${sentences.length + 1}`, text: doc.slice(sentence.from, sentence.to), from: sentence.from, to: sentence.to, paragraphIndex });
		}
	});
	return sentences;
}

/** The note as numbered sentences, one paragraph per block, for prompts. */
export function renderNumbered(sentences: NumberedSentence[]): string {
	const lines: string[] = [];
	let currentParagraph = -1;
	for (const sentence of sentences) {
		if (sentence.paragraphIndex !== currentParagraph) {
			if (lines.length) lines.push("");
			currentParagraph = sentence.paragraphIndex;
		}
		lines.push(`[${sentence.id}] ${sentence.text.replace(/\s*\n\s*/g, " ")}`);
	}
	return lines.join("\n");
}
