import { Type } from "typebox";

export interface TrimInput {
	numberedNote: string;
	totalWords: number;
	targetPercent: number;
	/** Text the writer chose to keep. The model must not propose it again. */
	keep: string[];
}

export interface TrimOutput {
	deletions: Array<{ unit_id: string; quote: string; why: string }>;
}

export const TRIM_TOOL = "propose_deletions";

export const trimSchema = Type.Object(
	{
		deletions: Type.Array(
			Type.Object(
				{
					unit_id: Type.String({ description: "Id of the sentence the quote comes from, like s4" }),
					quote: Type.String({ description: "Exact text to delete, copied character for character" }),
					why: Type.String({ description: "A few words on why it can go" }),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

export const TRIM_SYSTEM = `You are an editor helping a writer cut their draft. You may only delete. You never add, rephrase, reorder or replace a single word.

How to answer:
- Each deletion is an exact quote from one sentence, copied character for character, including punctuation. It can be a word, a phrase, a clause, or the whole sentence.
- After all deletions, every sentence that remains must still be grammatical and read naturally. If cutting a phrase would leave a dangling comma or a broken sentence, include the punctuation in the quote or choose a different cut.
- Prefer cutting repetition, throat-clearing, filler, hedges, weak qualifiers, redundant examples and sentences that restate the previous one. Keep the writer's meaning, voice and best lines.
- Do not overlap deletions. Do not quote across sentence boundaries; use separate deletions instead.
- List deletions from most expendable to least expendable. The writer's tool keeps them in that order until the target is reached, so put the cuts you are surest about first.
- Aim for the requested number of words. A few extra candidates past the target are fine; list them last.`;

export function trimPrompt(input: TrimInput): string {
	const targetWords = Math.round((input.totalWords * input.targetPercent) / 100);
	const keep = input.keep.length ? `\n\nThe writer wants to keep these. Do not propose them:\n${input.keep.map((text) => `- ${text}`).join("\n")}` : "";
	return `Cut about ${input.targetPercent}% of this note: roughly ${targetWords} of its ${input.totalWords} words.

The note, one sentence per line with ids:

${input.numberedNote}${keep}`;
}
