import { Type } from "typebox";

export interface SpotsInput {
	noteTitle: string;
	numberedNote: string;
	/** Most spots to return. */
	maxSpots: number;
	/** Alternatives per spot. */
	perSpot: number;
	/** Text that already has versions; the model should pick other spots. */
	existingSpans: string[];
}

export interface SpotsOutput {
	spots: Array<{ unit_id: string; quote: string; why: string; alternatives: string[] }>;
}

export const SPOTS_TOOL = "submit_spots";

export const spotsSchema = Type.Object(
	{
		spots: Type.Array(
			Type.Object(
				{
					unit_id: Type.String({ description: "Id of the sentence the quote comes from, like s4" }),
					quote: Type.String({ description: "The exact word, phrase or sentence, copied character for character" }),
					why: Type.String({ description: "A few words on why this spot is worth playing with" }),
					alternatives: Type.Array(Type.String(), { description: "Versions that drop into the same place" }),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

export const SPOTS_SYSTEM = `You help a writer find the places in their draft where trying another wording is most worth it, and offer options for each. The writer picks; the draft only changes when they choose an option.

How to pick spots:
- Most spots should be a single word or a phrase of two to four words where the choice carries weight: vague or generic words, weak verbs, clichés, stacked qualifiers, a word that clashes with the tone, a key term the piece leans on.
- At most two spots may be longer: a clause, or a whole sentence such as the title, the opening line or the closing line.
- Skip spots that are already sharp. Fewer good spots beat many weak ones.
- Never pick text that already has versions, and never overlap two spots.

How to write alternatives:
- Each one must read naturally when it replaces the quote in place. The surrounding words stay exactly as they are, so match grammar, tense, number and capitalisation.
- Match the writer's voice. Plain stays plain. Offer real choices with different shades of meaning, not a thesaurus list.
- No quotation marks around alternatives, no markdown, no explanations inside them.`;

export function spotsPrompt(input: SpotsInput): string {
	const existing = input.existingSpans.length ? `\n\nAlready has versions, so skip these:\n${input.existingSpans.map((text) => `- ${text}`).join("\n")}` : "";
	return `Note title: ${input.noteTitle}

Pick up to ${input.maxSpots} spots and give ${input.perSpot} alternatives for each. Quote each spot exactly, with its sentence id.${existing}

The text, one sentence per line with ids:

${input.numberedNote}`;
}
