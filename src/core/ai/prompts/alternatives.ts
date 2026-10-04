import { Type } from "typebox";
import type { SpanUnit } from "../../model/types";

export interface AlternativesInput {
	noteTitle: string;
	unit: SpanUnit;
	spanText: string;
	/** The paragraph containing the span, with the span marked by ⟦ ⟧. */
	paragraphWithMarker: string;
	previousParagraph: string;
	nextParagraph: string;
	existingVersions: string[];
	count: number;
}

export interface AlternativesOutput {
	alternatives: Array<{ text: string }>;
}

export const ALTERNATIVES_TOOL = "submit_alternatives";

export const alternativesSchema = Type.Object(
	{ alternatives: Type.Array(Type.Object({ text: Type.String() }, { additionalProperties: false })) },
	{ additionalProperties: false },
);

const UNIT_GUIDANCE: Record<SpanUnit, string> = {
	word: "a single word or a short phrase that drops into the exact same spot in the sentence",
	sentence: "one complete sentence (or heading) that takes the place of the marked one",
	paragraph: "one complete paragraph that takes the place of the marked one, saying the same thing",
};

export const ALTERNATIVES_SYSTEM = `You help a writer find the right way to say something. You suggest alternative versions of one marked piece of their text. The writer picks; you only offer options.

Rules:
- Each alternative must read naturally when it replaces the marked text in place. The words around it stay exactly as they are, so match grammar, tense, number and capitalisation for that spot.
- Match the writer's voice: their vocabulary, rhythm and register. Plain stays plain. Do not make it fancier, punchier or more "engaging".
- Offer real choices with different shades of meaning or emphasis that fit the context. Not a thesaurus list.
- Never repeat a version the writer already has, and do not offer trivial variants of each other.
- No quotation marks around the text, no markdown, no notes or explanations.
- For a word or phrase, do not include punctuation that sits outside the marked text.`;

export function alternativesPrompt(input: AlternativesInput): string {
	const context = [
		input.previousParagraph && `Paragraph before:\n${input.previousParagraph}`,
		`Paragraph with the marked text (between ⟦ and ⟧):\n${input.paragraphWithMarker}`,
		input.nextParagraph && `Paragraph after:\n${input.nextParagraph}`,
	]
		.filter(Boolean)
		.join("\n\n");
	const existing = input.existingVersions.map((version) => `- ${version}`).join("\n");
	return `Note title: ${input.noteTitle}

${context}

Marked text: ${input.spanText}
Each alternative should be ${UNIT_GUIDANCE[input.unit]}.

Versions the writer already has (do not repeat these):
${existing}

Give ${input.count} alternatives.`;
}
