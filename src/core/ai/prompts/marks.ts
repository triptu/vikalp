import { Type } from "typebox";
import type { LabPassId } from "../passes";

export interface MarksInput {
	pass: LabPassId;
	numberedNote: string;
	/** For the long-sentences pass: ids of sentences over the length threshold, with word counts. */
	longCandidates?: Array<{ id: string; words: number }>;
	/** For the tone pass: excerpts from notes the writer named as sounding like them. */
	voiceExcerpts?: string[];
}

export interface MarksOutput {
	marks: Array<{ unit_id: string; quote: string; reason: string; suggestion?: string }>;
}

export const MARKS_TOOL = "submit_marks";

export function marksSchema(withSuggestion: boolean) {
	const fields = {
		unit_id: Type.String({ description: "Id of the sentence the quote comes from, like s4" }),
		quote: Type.String({ description: "Exact text being marked, copied character for character" }),
		reason: Type.String({ description: "One short line explaining the mark" }),
	};
	const mark = withSuggestion
		? Type.Object({ ...fields, suggestion: Type.String({ description: "The corrected text that replaces the quote exactly" }) }, { additionalProperties: false })
		: Type.Object(fields, { additionalProperties: false });
	return Type.Object({ marks: Type.Array(mark) }, { additionalProperties: false });
}

export const MARKS_SYSTEM = `You are a careful editor marking problems in a writer's draft. You never rewrite their prose. You point at exact text and say briefly what is wrong; the writer decides what to do.

How to answer:
- Every mark quotes text exactly as it appears in one sentence, character for character, with its sentence id.
- Reasons are one short, plain line. No praise, no hedging, no lectures.
- Mark only real problems. Returning few or no marks is fine and expected for clean writing.`;

const PASS_INSTRUCTIONS: Record<LabPassId, string> = {
	typos: `Find spelling mistakes, typos, wrong or missing punctuation, and agreement errors (subject–verb, tense slips, a/an). For each, quote the smallest stretch of text that contains the error and give "suggestion": that same stretch corrected.
Strict limits: only fix errors. Do not change word choice, style, tone, or sentence structure. Do not "improve" anything that is already correct. Leave intentional informal style alone. The suggestion must differ from the quote only by the fix.`,
	weakest: `Pick up to five sentences that are the weakest in the piece: vague, empty, clichéd, redundant, or that undercut the point. Quote each whole sentence. The reason says what makes it weak.`,
	long: `These sentences are long. Judge each one: mark it only if its length actually hurts — the reader loses the thread, too many ideas are packed in, or it should clearly be split. Long sentences that flow well stay unmarked. Quote the whole sentence.`,
	convoluted: `Mark sentences whose structure a reader has to untangle: nested clauses, buried subjects, double negatives, ambiguous references, ideas in a confusing order. Quote the whole sentence, or the tangled clause if that is clearer.`,
	tone: `Mark individual words or short phrases that don't fit the tone of the rest of the note — for example a needlessly fancy, technical, corporate or overly casual word in otherwise plain writing. Quote just the word or phrase. The reason names the clash in a few words.`,
	hedges: `Mark hedges and filler: words and phrases that soften, qualify or pad without adding meaning ("I think", "sort of", "it seems", "really", "basically", "in a way", "perhaps"). Include hedges a simple word list would miss, like hedging constructions. Quote just the hedge or filler words. Leave hedges that are honest uncertainty the writer clearly means.`,
};

export function marksPrompt(input: MarksInput): string {
	const parts = [PASS_INSTRUCTIONS[input.pass]];
	if (input.pass === "long" && input.longCandidates) {
		parts.push(`Long sentences to judge: ${input.longCandidates.map((candidate) => `${candidate.id} (${candidate.words} words)`).join(", ")}. Only mark from this list.`);
	}
	if (input.pass === "tone" && input.voiceExcerpts?.length) {
		parts.push(`The writer named these notes as examples of their real voice. Judge tone against them:\n\n${input.voiceExcerpts.map((excerpt) => `---\n${excerpt}`).join("\n")}\n---`);
	}
	parts.push(`The note, one sentence per line with ids:\n\n${input.numberedNote}`);
	return parts.join("\n\n");
}
