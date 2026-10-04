import type { LintScope, TextRange } from "../model/types";
import type { LintContext, LintHitDraft, Rule } from "./types";

/** A sentence, a paragraph or the whole note, with the sentences inside it. */
export interface LintUnit extends TextRange {
	sentences: TextRange[];
	paragraphCount: number;
}

/** The units a rule of this scope looks at. Headings are left out: they are titles, not prose. */
export function proseUnits(context: LintContext, scope: LintScope): LintUnit[] {
	const paragraphs = context.paragraphs.filter((paragraph) => paragraph.kind !== "heading");
	if (scope === "sentence") {
		return paragraphs.flatMap((paragraph) =>
			paragraph.sentences.map((sentence) => ({ from: sentence.from, to: sentence.to, sentences: [sentence], paragraphCount: 1 })),
		);
	}
	if (scope === "paragraph") {
		return paragraphs.map((paragraph) => ({ from: paragraph.from, to: paragraph.to, sentences: paragraph.sentences, paragraphCount: 1 }));
	}
	return [{ ...documentRange(context), sentences: paragraphs.flatMap((paragraph) => paragraph.sentences), paragraphCount: paragraphs.length }];
}

export function documentRange(context: LintContext): TextRange {
	return { from: 0, to: context.doc.length };
}

export function draftHit(rule: Rule, range: TextRange, message: string, suggestion?: string): LintHitDraft {
	const hit: LintHitDraft = {
		ruleId: rule.id,
		label: rule.label,
		message,
		severity: rule.severity,
		scope: rule.scope,
		from: range.from,
		to: range.to,
	};
	if (suggestion !== undefined) hit.suggestion = suggestion;
	return hit;
}

/** Replaces every `%s` in a rule message. */
export function fillMessage(template: string, value: string): string {
	return template.replaceAll("%s", value);
}
