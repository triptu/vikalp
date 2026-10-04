import type { TextRange } from "../model/types";
import { matchableText } from "./prose";
import type { LintContext, LintHitDraft, Rule } from "./types";
import { documentRange, draftHit } from "./units";

export interface PhraseMatch extends TextRange {
	/** The matched text as written in the note. */
	text: string;
}

/**
 * Every match of the patterns in the note's prose, without overlaps. Matching
 * runs one sentence or one paragraph at a time, so `^` and `$` mean the start
 * and end of that unit and no match runs across two paragraphs.
 */
export function findMatches(context: LintContext, matchWithin: "sentence" | "paragraph", patterns: RegExp[]): PhraseMatch[] {
	const prose = matchableText(context.doc);
	const units: TextRange[] = matchWithin === "sentence" ? context.paragraphs.flatMap((paragraph) => paragraph.sentences) : context.paragraphs;
	const found: PhraseMatch[] = [];
	for (const unit of units) {
		const unitText = prose.slice(unit.from, unit.to);
		for (const pattern of patterns) {
			for (const match of unitText.matchAll(pattern)) {
				if (match[0].length === 0) continue;
				const from = unit.from + match.index;
				const to = from + match[0].length;
				found.push({ from, to, text: context.doc.slice(from, to) });
			}
		}
	}
	return withoutOverlaps(found);
}

function withoutOverlaps(matches: PhraseMatch[]): PhraseMatch[] {
	const ordered = [...matches].sort((a, b) => a.from - b.from || b.to - a.to);
	const kept: PhraseMatch[] = [];
	for (const match of ordered) {
		const previous = kept[kept.length - 1];
		if (!previous || match.from >= previous.to) kept.push(match);
	}
	return kept;
}

export interface MatchOutcome {
	message: string;
	suggestion?: string;
}

/**
 * Turns matches into hits. Sentence rules get one hit per match covering the
 * matched words. Paragraph rules get one hit per paragraph and document rules
 * one hit for the note, described by the first match. Suggestions only apply
 * to word-level hits.
 */
export function hitsFromMatches(
	rule: Rule,
	context: LintContext,
	matches: PhraseMatch[],
	describe: (match: PhraseMatch) => MatchOutcome,
): LintHitDraft[] {
	if (rule.scope === "sentence") {
		return matches.map((match) => {
			const outcome = describe(match);
			return draftHit(rule, match, outcome.message, outcome.suggestion);
		});
	}
	if (rule.scope === "paragraph") {
		const hits: LintHitDraft[] = [];
		const flaggedParagraphs = new Set<number>();
		for (const match of matches) {
			const paragraph = context.paragraphs.find((candidate) => candidate.from <= match.from && match.to <= candidate.to);
			if (!paragraph || flaggedParagraphs.has(paragraph.from)) continue;
			flaggedParagraphs.add(paragraph.from);
			hits.push(draftHit(rule, { from: paragraph.from, to: paragraph.to }, describe(match).message));
		}
		return hits;
	}
	const firstMatch = matches[0];
	return firstMatch ? [draftHit(rule, documentRange(context), describe(firstMatch).message)] : [];
}
