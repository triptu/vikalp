import type { LintScope, Severity } from "../model/types";
import { parseRule, serializeRule } from "./parse";
import type { MetricName, Rule, RuleEngineName, RuleParseResult } from "./types";

/** A rule as the editor form holds it: list fields are plain multi-line text. */
export interface RuleDraft {
	id: string;
	label: string;
	description: string;
	scope: LintScope;
	severity: Severity;
	engine: RuleEngineName;
	message: string;
	/** Phrases: one per line. */
	phrases: string;
	/** Phrases with fixes: one `phrase → fix` per line. */
	fixes: string;
	/** Patterns: one regular expression per line. */
	patterns: string;
	ignoreCase: boolean;
	metric: MetricName;
	max: string;
	minWords: string;
	question: string;
	threshold: number;
	prompt: string;
	/** An extra AI yes/no check that runs alongside a local rule. */
	aiCheck: boolean;
	aiQuestion: string;
	aiThreshold: number;
	aiMessage: string;
}

export interface EngineChoice {
	engine: RuleEngineName;
	name: string;
	hint: string;
	usesAi: boolean;
}

export const ENGINE_CHOICES: EngineChoice[] = [
	{ engine: "wordlist", name: "Phrases", hint: "Flags exact words or phrases. Whole words only; case and curly quotes don't matter.", usesAi: false },
	{ engine: "substitution", name: "Phrases with fixes", hint: "Flags a phrase and suggests a plainer one you can apply.", usesAi: false },
	{ engine: "regex", name: "Pattern", hint: "A regular expression, for shapes a phrase list can't catch, like “not just X, but Y”.", usesAi: false },
	{ engine: "metric", name: "Measurement", hint: "Flags text when a number goes over a limit, like words in a sentence.", usesAi: false },
	{ engine: "classifier", name: "AI yes/no question", hint: "Jev answers a yes/no question about each sentence or paragraph. Costs a little per run.", usesAi: true },
	{ engine: "llm", name: "AI finds quotes", hint: "The selected model reads the note and quotes what matches your instructions. Costs more than a yes/no question.", usesAi: true },
];

export const METRIC_CHOICES: Array<{ metric: MetricName; name: string }> = [
	{ metric: "sentence-words", name: "Words in a sentence" },
	{ metric: "paragraph-words", name: "Words in a paragraph" },
	{ metric: "readability-grade", name: "Reading grade (ARI)" },
	{ metric: "long-word-ratio", name: "Share of words with 3+ syllables (0–1)" },
	{ metric: "adverb-density", name: "Share of -ly adverbs (0–1)" },
	{ metric: "repeated-word", name: "Times a word repeats within 20 words" },
	{ metric: "repeated-opener", name: "Sentences in a row starting the same way" },
	{ metric: "one-sentence-paragraph-run", name: "One-sentence paragraphs in a row" },
	{ metric: "one-sentence-paragraph-ratio", name: "Share of one-sentence paragraphs (0–1)" },
	{ metric: "em-dash-density", name: "Em dashes per 100 words" },
];

export function engineChoice(engine: RuleEngineName): EngineChoice {
	return ENGINE_CHOICES.find((choice) => choice.engine === engine) ?? ENGINE_CHOICES[0]!;
}

export function emptyDraft(id: string): RuleDraft {
	return {
		id,
		label: "",
		description: "",
		scope: "sentence",
		severity: "warning",
		engine: "wordlist",
		message: "",
		phrases: "",
		fixes: "",
		patterns: "",
		ignoreCase: true,
		metric: "sentence-words",
		max: "30",
		minWords: "",
		question: "",
		threshold: 0.7,
		prompt: "",
		aiCheck: false,
		aiQuestion: "",
		aiThreshold: 0.7,
		aiMessage: "",
	};
}

const FIX_ARROW = " → ";

export function draftFromRule(rule: Rule): RuleDraft {
	const draft: RuleDraft = {
		...emptyDraft(rule.id),
		label: rule.label,
		description: rule.description ?? "",
		scope: rule.scope,
		severity: rule.severity,
		engine: rule.engine,
		message: rule.message ?? "",
	};
	if (rule.judgment) {
		draft.aiCheck = true;
		draft.aiQuestion = rule.judgment.question;
		draft.aiThreshold = rule.judgment.threshold;
		draft.aiMessage = rule.judgment.message ?? "";
	}
	switch (rule.engine) {
		case "wordlist":
			draft.phrases = rule.tokens.join("\n");
			draft.ignoreCase = rule.ignorecase ?? true;
			break;
		case "substitution":
			draft.fixes = Object.entries(rule.swap)
				.map(([phrase, fix]) => `${phrase}${FIX_ARROW}${fix}`.trimEnd())
				.join("\n");
			draft.ignoreCase = rule.ignorecase ?? true;
			break;
		case "regex":
			draft.patterns = rule.patterns.join("\n");
			draft.ignoreCase = rule.ignorecase ?? true;
			break;
		case "metric":
			draft.metric = rule.metric;
			draft.max = String(rule.max);
			draft.minWords = rule.minWords === undefined ? "" : String(rule.minWords);
			break;
		case "classifier":
			draft.question = rule.question;
			draft.threshold = rule.threshold;
			break;
		case "llm":
			draft.prompt = rule.prompt;
			break;
	}
	return draft;
}

function lines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function parseFixes(text: string): Record<string, string> {
	const swap: Record<string, string> = {};
	for (const line of lines(text)) {
		const [phrase, ...rest] = line.split(/\s*(?:→|->|=>)\s*/);
		if (phrase) swap[phrase.trim()] = rest.join(" ").trim();
	}
	return swap;
}

/**
 * Turns the form back into a rule and checks it with the same validation as
 * rule files, so the editor reports exactly the errors a YAML file would.
 */
export function ruleFromDraft(draft: RuleDraft): RuleParseResult {
	const base = {
		id: draft.id.trim(),
		label: draft.label.trim() || draft.id.trim(),
		scope: draft.scope,
		severity: draft.severity,
		...(draft.description.trim() ? { description: draft.description.trim() } : {}),
		...(draft.message.trim() ? { message: draft.message.trim() } : {}),
	};
	const judgment =
		draft.aiCheck && draft.engine !== "classifier" && draft.engine !== "llm" && draft.aiQuestion.trim()
			? {
					judgment: {
						question: draft.aiQuestion.trim(),
						threshold: draft.aiThreshold,
						...(draft.aiMessage.trim() ? { message: draft.aiMessage.trim() } : {}),
					},
				}
			: {};
	let rule: Rule;
	switch (draft.engine) {
		case "wordlist":
			rule = { ...base, ...judgment, engine: "wordlist", tokens: lines(draft.phrases), ignorecase: draft.ignoreCase };
			break;
		case "substitution":
			rule = { ...base, ...judgment, engine: "substitution", swap: parseFixes(draft.fixes), ignorecase: draft.ignoreCase };
			break;
		case "regex":
			rule = { ...base, ...judgment, engine: "regex", patterns: lines(draft.patterns), ignorecase: draft.ignoreCase };
			break;
		case "metric":
			rule = {
				...base,
				...judgment,
				engine: "metric",
				metric: draft.metric,
				max: Number(draft.max),
				...(draft.minWords.trim() ? { minWords: Number(draft.minWords) } : {}),
			};
			break;
		case "classifier":
			rule = { ...base, engine: "classifier", question: draft.question.trim(), threshold: draft.threshold };
			break;
		case "llm":
			rule = { ...base, engine: "llm", prompt: draft.prompt.trim() };
			break;
	}
	return parseRule(serializeRule(rule));
}

/** A rule id for a new rule, based on its label and unique among `taken`. */
export function newRuleId(label: string, taken: Set<string>): string {
	const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rule";
	let id = `my.${slug}`;
	for (let suffix = 2; taken.has(id); suffix++) id = `my.${slug}-${suffix}`;
	return id;
}
