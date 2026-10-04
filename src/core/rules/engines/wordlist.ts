import { findMatches, hitsFromMatches } from "../match";
import { phraseRegex } from "../phrases";
import type { LintContext, LintHitDraft, WordlistRule } from "../types";
import { fillMessage } from "../units";

/** Flags every occurrence of a listed word or phrase. */
export function runWordlistRule(rule: WordlistRule, context: LintContext): LintHitDraft[] {
	const pattern = phraseRegex(rule.tokens, rule.ignorecase ?? true);
	if (!pattern) return [];
	const template = rule.message ?? `${rule.label}: '%s'`;
	const matches = findMatches(context, "paragraph", [pattern]);
	return hitsFromMatches(rule, context, matches, (match) => ({ message: fillMessage(template, match.text) }));
}
