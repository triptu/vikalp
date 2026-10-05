import type { Rule } from "./types";

/** One line per built-in rule family, for the settings page. */
const FAMILY_DESCRIPTIONS: Record<string, string> = {
	Hedging: "Softening a claim more than it needs: 'I think', 'sort of', 'studies show'.",
	Wordy: "Padded phrases, filler words and very long sentences.",
	Verbose: "Paragraphs that run long or say one thing several ways.",
	Complicated: "Sentences that are hard to read: high reading level, many long words.",
	"AI-sounding": "Words, phrases and shapes that chatbots overuse.",
	"LinkedIn voice": "Hook openers, one-line paragraphs, 'Agree?' closers, posts that read like LinkedIn.",
	Repetition: "The same word, or the same sentence opener, too close together.",
	Awkward: "Sentences that are hard to follow on a first read.",
	"Passive voice": "Passives that name who acted: 'was written by'.",
	Adverbs: "Sentences heavy with -ly adverbs.",
};

export interface RuleFamily {
	label: string;
	description: string;
	rules: Rule[];
}

/**
 * Groups rules that share a label. Built-in ideas like "Hedging" are made of
 * several small rules (a word list, a pattern, an AI check), and people think
 * of them as one thing.
 */
export function groupRulesByLabel(rules: Rule[]): RuleFamily[] {
	const families = new Map<string, RuleFamily>();
	for (const rule of rules) {
		const family = families.get(rule.label) ?? {
			label: rule.label,
			description: FAMILY_DESCRIPTIONS[rule.label] ?? rule.description ?? "",
			rules: [],
		};
		family.rules.push(rule);
		families.set(rule.label, family);
	}
	return [...families.values()];
}

export function usesAi(rule: Rule): boolean {
	return rule.engine === "classifier" || rule.engine === "llm" || Boolean(rule.judgment);
}
