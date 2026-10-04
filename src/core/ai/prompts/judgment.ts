import { Type } from "typebox";

export interface JudgmentItem {
	id: string;
	question: string;
	text: string;
	context: string;
}

export interface JudgmentOutput {
	answers: Array<{ id: string; probability: number }>;
}

export const JUDGMENT_TOOL = "submit_judgments";

export const judgmentSchema = Type.Object(
	{
		answers: Type.Array(
			Type.Object(
				{
					id: Type.String(),
					probability: Type.Number({ description: "How likely the answer is yes, from 0 to 1" }),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

export const JUDGMENT_SYSTEM = `You answer yes/no questions about pieces of a writer's draft. For each item give the probability, from 0 to 1, that the answer is yes. Judge strictly and calmly: ordinary, clear writing should get low probabilities. Answer every item by id.`;

/** Used when Jev is unavailable, or when the user picks the LLM engine for judgment rules. */
export function judgmentPrompt(items: JudgmentItem[]): string {
	return items
		.map((item) => `Item ${item.id}\nQuestion: ${item.question}\nText: ${item.text}${item.context && item.context !== item.text ? `\nIn context: ${item.context}` : ""}`)
		.join("\n\n");
}

export interface LlmRuleOutput {
	hits: Array<{ unit_id: string; quote: string; reason: string }>;
}

export const LLM_RULE_TOOL = "submit_hits";

export const llmRuleSchema = Type.Object(
	{
		hits: Type.Array(
			Type.Object({ unit_id: Type.String(), quote: Type.String(), reason: Type.String() }, { additionalProperties: false }),
		),
	},
	{ additionalProperties: false },
);

export function llmRulePrompt(rulePrompt: string, numberedNote: string): string {
	return `${rulePrompt}

Quote the exact text for each hit, character for character, with its sentence id, and a short reason. Return no hits if nothing applies.

The note, one sentence per line with ids:

${numberedNote}`;
}
