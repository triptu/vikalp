import { findMatches, hitsFromMatches } from "../match";
import { compileRulePattern } from "../phrases";
import type { LintContext, LintHitDraft, RegexRule } from "../types";
import { fillMessage } from "../units";

/**
 * Flags every match of the rule's patterns. Sentence rules match one sentence
 * at a time, so `^` and `$` mean the start and end of a sentence; other scopes
 * match one paragraph at a time. Patterns that do not compile are skipped
 * (parsing reports them).
 */
export function runRegexRule(rule: RegexRule, context: LintContext): LintHitDraft[] {
	const patterns = rule.patterns.flatMap((source) => {
		try {
			return [compileRulePattern(source, rule.ignorecase ?? true)];
		} catch {
			return [];
		}
	});
	const template = rule.message ?? `${rule.label}: '%s'`;
	const matches = findMatches(context, rule.scope === "sentence" ? "sentence" : "paragraph", patterns);
	return hitsFromMatches(rule, context, matches, (match) => ({ message: fillMessage(template, match.text) }));
}
