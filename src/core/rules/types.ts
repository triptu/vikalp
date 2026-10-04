import type { LintScope, Severity, TextRange } from "../model/types";
import type { ParagraphUnit } from "../text/segment";

export type LocalEngine = "wordlist" | "regex" | "substitution" | "metric";
export type JudgmentEngine = "classifier" | "llm";
export type RuleEngineName = LocalEngine | JudgmentEngine;

/**
 * A yes/no judgment asked of Jev (or the Lite model as a fallback, or when the
 * user picks the LLM engine for judgment rules). Asked once per unit in scope.
 */
export interface JudgmentCheck {
	question: string;
	/** Probability at or above which the unit is flagged. 0..1. */
	threshold: number;
	/** Shown on the hit. Defaults to the rule label. */
	message?: string;
}

interface RuleBase {
	id: string;
	label: string;
	scope: LintScope;
	severity: Severity;
	/** One line explaining what the rule catches. Shown in the Lint panel and settings. */
	description?: string;
	/** `%s` is replaced with the matched text. */
	message?: string;
	/** Optional judgment check that runs alongside the local engine. */
	judgment?: JudgmentCheck;
	/** Where the rule came from: shipped with the plugin or a user file. */
	origin?: "builtin" | "user";
}

export interface WordlistRule extends RuleBase {
	engine: "wordlist";
	tokens: string[];
	/** Defaults to true. */
	ignorecase?: boolean;
}

export interface RegexRule extends RuleBase {
	engine: "regex";
	/** JavaScript regular expression sources. Each match is a hit. */
	patterns: string[];
	/** Extra flags. `g` is always added; `i` is added unless `ignorecase: false`. */
	ignorecase?: boolean;
}

export interface SubstitutionRule extends RuleBase {
	engine: "substitution";
	/** Wordy phrase → plain replacement. */
	swap: Record<string, string>;
	ignorecase?: boolean;
}

export type MetricName =
	| "sentence-words"
	| "readability-grade"
	| "long-word-ratio"
	| "adverb-density"
	| "repeated-word"
	| "repeated-opener"
	| "one-sentence-paragraph-run"
	| "one-sentence-paragraph-ratio"
	| "em-dash-density"
	| "paragraph-words";

export interface MetricRule extends RuleBase {
	engine: "metric";
	metric: MetricName;
	/** Flag when the metric is above this value. */
	max: number;
	/** Units with fewer words than this are skipped (avoids flagging tiny sentences). */
	minWords?: number;
}

export interface ClassifierRule extends RuleBase {
	engine: "classifier";
	question: string;
	threshold: number;
}

export interface LlmRule extends RuleBase {
	engine: "llm";
	/** Instructions for the model. It returns exact quotes with a short reason. */
	prompt: string;
}

export type Rule = WordlistRule | RegexRule | SubstitutionRule | MetricRule | ClassifierRule | LlmRule;

/** What a local engine sees: the note text and its prose structure. */
export interface LintContext {
	doc: string;
	paragraphs: ParagraphUnit[];
}

export interface LintHitDraft extends TextRange {
	ruleId: string;
	label: string;
	message: string;
	severity: Severity;
	scope: LintScope;
	suggestion?: string;
}

export type RuleParseResult = { ok: true; rule: Rule } | { ok: false; errors: string[] };
