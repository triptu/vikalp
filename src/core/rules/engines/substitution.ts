import { findMatches, hitsFromMatches } from "../match";
import { phraseKey, phraseRegex } from "../phrases";
import type { LintContext, LintHitDraft, SubstitutionRule } from "../types";
import { fillMessage } from "../units";

/**
 * Flags wordy phrases and offers the plain replacement as the hit's
 * suggestion. In the message, `%s` is the matched text and `%r` the
 * replacement; if the message has no `%r`, the suggestion is added at the end.
 */
export function runSubstitutionRule(rule: SubstitutionRule, context: LintContext): LintHitDraft[] {
	const ignorecase = rule.ignorecase ?? true;
	const pattern = phraseRegex(Object.keys(rule.swap), ignorecase);
	if (!pattern) return [];
	const replacements = new Map(Object.entries(rule.swap).map(([phrase, replacement]) => [phraseKey(phrase, ignorecase), replacement]));
	const template = rule.message ?? `${rule.label}: '%s'.`;
	const matches = findMatches(context, "paragraph", [pattern]);
	return hitsFromMatches(rule, context, matches, (match) => {
		const replacement = matchCase(replacements.get(phraseKey(match.text, ignorecase)) ?? "", match.text);
		return { message: substitutionMessage(template, match.text, replacement), suggestion: replacement };
	});
}

function substitutionMessage(template: string, matched: string, replacement: string): string {
	const advice = replacement === "" ? "Try cutting it." : `Try '${replacement}'.`;
	const withMatch = fillMessage(template, matched);
	return withMatch.includes("%r") ? withMatch.replaceAll("%r", replacement) : `${withMatch} ${advice}`;
}

function matchCase(replacement: string, matched: string): string {
	const startsUpper = matched[0] !== undefined && matched[0] !== matched[0].toLowerCase();
	return startsUpper ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}
