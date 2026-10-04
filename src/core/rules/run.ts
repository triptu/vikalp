import type { TextRange } from "../model/types";
import { segmentNote } from "../text/segment";
import { runMetricRule } from "./engines/metric";
import { runRegexRule } from "./engines/regex";
import { runSubstitutionRule } from "./engines/substitution";
import { runWordlistRule } from "./engines/wordlist";
import type { LintContext, LintHitDraft, LocalEngine, Rule } from "./types";

export type LocalRule = Extract<Rule, { engine: LocalEngine }>;

export function isLocalRule(rule: Rule): rule is LocalRule {
	return rule.engine !== "classifier" && rule.engine !== "llm";
}

export function createLintContext(doc: string): LintContext {
	return { doc, paragraphs: segmentNote(doc) };
}

/**
 * Runs every local rule (wordlist, regex, substitution, metric) over the note
 * and returns the hits in document order. Classifier and LLM rules are
 * skipped; see `judgmentTasks` for those.
 */
export function runLocalRules(rules: Rule[], doc: string): LintHitDraft[] {
	const context = createLintContext(doc);
	const hits = rules.filter(isLocalRule).flatMap((rule) => runLocalRule(rule, context));
	return hits.sort((a, b) => a.from - b.from || a.to - b.to || a.ruleId.localeCompare(b.ruleId));
}

function runLocalRule(rule: LocalRule, context: LintContext): LintHitDraft[] {
	switch (rule.engine) {
		case "wordlist":
			return runWordlistRule(rule, context);
		case "regex":
			return runRegexRule(rule, context);
		case "substitution":
			return runSubstitutionRule(rule, context);
		case "metric":
			return runMetricRule(rule, context);
	}
}

export interface JudgmentUnit extends TextRange {
	text: string;
}

/** One yes/no question about one sentence, paragraph or note. */
export interface JudgmentTask {
	rule: Rule;
	/** The classifier question, or the instructions of an LLM rule. */
	question: string;
	/** Probability at or above which the unit is flagged. Null for LLM rules, which answer with quotes. */
	threshold: number | null;
	/** Message for a hit on this unit. */
	message: string;
	unit: JudgmentUnit;
	/** The paragraph around the unit, as context. The whole note for document rules. */
	paragraph: JudgmentUnit;
}

/**
 * The judgment work for a run: one task per unit in scope for every
 * classifier rule, LLM rule, and local rule with a `judgment` check. Sentence
 * rules get a task per sentence, paragraph rules one per paragraph, document
 * rules one for the note. Headings are skipped.
 */
export function judgmentTasks(rules: Rule[], doc: string): JudgmentTask[] {
	const paragraphs = segmentNote(doc).filter((paragraph) => paragraph.kind !== "heading");
	const unitOf = (range: TextRange): JudgmentUnit => ({ from: range.from, to: range.to, text: doc.slice(range.from, range.to) });
	const tasks: JudgmentTask[] = [];
	for (const rule of rules) {
		const question = judgmentQuestion(rule);
		if (!question) continue;
		const base = { rule, ...question };
		if (rule.scope === "document") {
			const wholeNote = unitOf({ from: 0, to: doc.length });
			tasks.push({ ...base, unit: wholeNote, paragraph: wholeNote });
			continue;
		}
		for (const paragraph of paragraphs) {
			const paragraphUnit = unitOf(paragraph);
			if (rule.scope === "paragraph") tasks.push({ ...base, unit: paragraphUnit, paragraph: paragraphUnit });
			else tasks.push(...paragraph.sentences.map((sentence) => ({ ...base, unit: unitOf(sentence), paragraph: paragraphUnit })));
		}
	}
	return tasks;
}

function judgmentQuestion(rule: Rule): Pick<JudgmentTask, "question" | "threshold" | "message"> | null {
	if (rule.engine === "classifier") {
		return { question: rule.question, threshold: rule.threshold, message: rule.message ?? rule.description ?? rule.label };
	}
	if (rule.engine === "llm") {
		return { question: rule.prompt, threshold: null, message: rule.message ?? rule.description ?? rule.label };
	}
	if (rule.judgment) {
		return { question: rule.judgment.question, threshold: rule.judgment.threshold, message: rule.judgment.message ?? rule.label };
	}
	return null;
}
