import type { TextRange } from "../../model/types";
import type { ParagraphUnit } from "../../text/segment";
import { matchableText } from "../prose";
import { contentStem, countSyllables, isLyAdverb, letterCount, placedWords, type PlacedWord } from "../stats";
import type { LintContext, LintHitDraft, MetricName, MetricRule } from "../types";
import { documentRange, draftHit, fillMessage, proseUnits, type LintUnit } from "../units";

/** How many words back the repeated-word metric looks. */
export const REPEAT_WINDOW_WORDS = 20;

/** The one-sentence-paragraph ratio needs at least this many paragraphs to mean anything. */
export const RATIO_MIN_PARAGRAPHS = 5;

/** Paragraphs shorter than this count as this long for em-dash density, so two dashes in a short paragraph are not a spike. */
const EM_DASH_MIN_WORDS = 100;

const DEFAULT_MESSAGES: Record<MetricName, string> = {
	"sentence-words": "Long sentence: %s.",
	"readability-grade": "Hard to read: %s.",
	"long-word-ratio": "Many long words: %s.",
	"adverb-density": "Adverb-heavy: %s.",
	"repeated-word": "'%s' repeats close together.",
	"repeated-opener": "'%s' starts several sentences in a row.",
	"one-sentence-paragraph-run": "One-sentence paragraphs: %s.",
	"one-sentence-paragraph-ratio": "Mostly one-sentence paragraphs: %s.",
	"em-dash-density": "Many em dashes: %s.",
	"paragraph-words": "Long paragraph: %s.",
};

type UnitMetricName = Exclude<MetricName, "repeated-word" | "repeated-opener" | "one-sentence-paragraph-run" | "one-sentence-paragraph-ratio">;

interface UnitText {
	unit: LintUnit;
	text: string;
	sentenceWords: PlacedWord[][];
	words: PlacedWord[];
	isSingleSentence: boolean;
}

interface Measurement {
	value: number;
	/** What `%s` becomes in the message, e.g. "38 words". */
	detail: string;
}

const UNIT_MEASURES: Record<UnitMetricName, (unitText: UnitText) => Measurement> = {
	"sentence-words": ({ words, sentenceWords, isSingleSentence }) => {
		const average = words.length / Math.max(1, sentenceWords.length);
		return { value: average, detail: isSingleSentence ? `${words.length} words` : `${Math.round(average)} words per sentence` };
	},
	"readability-grade": ({ words, sentenceWords }) => {
		const letters = words.reduce((total, word) => total + letterCount(word.text), 0);
		const grade = 4.71 * (letters / words.length) + 0.5 * (words.length / Math.max(1, sentenceWords.length)) - 21.43;
		return { value: grade, detail: `grade ${Math.round(grade)}` };
	},
	"long-word-ratio": ({ words }) => {
		const ratio = words.filter((word) => countSyllables(word.text) >= 3).length / words.length;
		return { value: ratio, detail: `${Math.round(ratio * 100)}% long words` };
	},
	"adverb-density": ({ sentenceWords, words }) => {
		const adverbs = sentenceWords.flatMap((sentence) => sentence.filter((word, index) => isLyAdverb(word.text, index === 0)));
		const distinct = [...new Set(adverbs.map((word) => word.text))];
		return { value: adverbs.length / words.length, detail: distinct.join(", ") };
	},
	"em-dash-density": ({ text, words }) => {
		const dashes = text.match(/—|(?<!-)--(?!-)/g)?.length ?? 0;
		return { value: (dashes / Math.max(words.length, EM_DASH_MIN_WORDS)) * 100, detail: `${dashes} em dashes` };
	},
	"paragraph-words": ({ words, unit }) => {
		const average = words.length / Math.max(1, unit.paragraphCount);
		return { value: average, detail: unit.paragraphCount > 1 ? `${Math.round(average)} words per paragraph` : `${words.length} words` };
	},
};

/**
 * Measures each sentence, paragraph or the whole note and flags units whose
 * value is above `max`. Units with fewer than `minWords` words are skipped.
 * Metric hits cover the whole unit.
 */
export function runMetricRule(rule: MetricRule, context: LintContext): LintHitDraft[] {
	switch (rule.metric) {
		case "repeated-word":
			return repeatedWordHits(rule, context);
		case "repeated-opener":
			return repeatedOpenerHits(rule, context);
		case "one-sentence-paragraph-run":
			return oneSentenceRunHits(rule, context);
		case "one-sentence-paragraph-ratio":
			return oneSentenceRatioHits(rule, context);
		default:
			return unitMetricHits(rule, context, UNIT_MEASURES[rule.metric]);
	}
}

function messageFor(rule: MetricRule, detail: string): string {
	return fillMessage(rule.message ?? DEFAULT_MESSAGES[rule.metric], detail);
}

function unitMetricHits(rule: MetricRule, context: LintContext, measure: (unitText: UnitText) => Measurement): LintHitDraft[] {
	const prose = matchableText(context.doc);
	const hits: LintHitDraft[] = [];
	for (const unit of proseUnits(context, rule.scope)) {
		const sentenceWords = unit.sentences.map((sentence) => placedWords(prose.slice(sentence.from, sentence.to), sentence.from));
		const words = sentenceWords.flat();
		if (words.length === 0 || words.length < (rule.minWords ?? 0)) continue;
		const text = unit.sentences.map((sentence) => prose.slice(sentence.from, sentence.to)).join(" ");
		const measurement = measure({ unit, text, sentenceWords, words, isSingleSentence: unit.sentences.length === 1 });
		if (measurement.value > rule.max) hits.push(draftHit(rule, unit, messageFor(rule, measurement.detail)));
	}
	return hits;
}

interface Flagged {
	range: TextRange;
	paragraph: ParagraphUnit;
}

/** Hits for flagged sentences: one per sentence, one per paragraph or one for the note, by the rule's scope. */
function hitsForFlagged(rule: MetricRule, context: LintContext, flagged: Flagged[], detail: string): LintHitDraft[] {
	if (flagged.length === 0) return [];
	const message = messageFor(rule, detail);
	if (rule.scope === "document") return [draftHit(rule, documentRange(context), message)];
	if (rule.scope === "sentence") return flagged.map(({ range }) => draftHit(rule, range, message));
	const paragraphs = [...new Set(flagged.map(({ paragraph }) => paragraph))];
	return paragraphs.map((paragraph) => draftHit(rule, { from: paragraph.from, to: paragraph.to }, message));
}

function proseParagraphs(context: LintContext): ParagraphUnit[] {
	return context.paragraphs.filter((paragraph) => paragraph.kind !== "heading");
}

/**
 * Counts how often each content word (four or more letters, not a stopword)
 * appears within the last REPEAT_WINDOW_WORDS words of the same paragraph,
 * and flags the sentence where the count first goes above `max`.
 */
function repeatedWordHits(rule: MetricRule, context: LintContext): LintHitDraft[] {
	const prose = matchableText(context.doc);
	const hits: LintHitDraft[] = [];
	for (const paragraph of proseParagraphs(context)) {
		const sentenceWords = paragraph.sentences.map((sentence) => placedWords(prose.slice(sentence.from, sentence.to), sentence.from));
		if (sentenceWords.flat().length < (rule.minWords ?? 0)) continue;
		const positionsByStem = new Map<string, number[]>();
		let position = 0;
		paragraph.sentences.forEach((sentence, sentenceIndex) => {
			let repeatedWord: string | null = null;
			for (const word of sentenceWords[sentenceIndex] ?? []) {
				position++;
				const stem = contentStem(word.text);
				if (!stem) continue;
				const recent = (positionsByStem.get(stem) ?? []).filter((earlier) => position - earlier < REPEAT_WINDOW_WORDS);
				recent.push(position);
				positionsByStem.set(stem, recent);
				if (recent.length > rule.max && repeatedWord === null) repeatedWord = word.text;
			}
			if (repeatedWord !== null) hits.push(...hitsForFlagged(rule, context, [{ range: sentence, paragraph }], repeatedWord));
		});
	}
	return dedupeByRange(rule.scope === "document" ? hits.slice(0, 1) : hits);
}

function dedupeByRange(hits: LintHitDraft[]): LintHitDraft[] {
	const seen = new Set<string>();
	return hits.filter((hit) => {
		const key = `${hit.from}:${hit.to}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

interface OpenedSentence extends Flagged {
	opener: string;
}

/**
 * Flags runs of more than `max` consecutive sentences that start with the
 * same word. Headings and list items break a run; lists often repeat openers
 * on purpose.
 */
function repeatedOpenerHits(rule: MetricRule, context: LintContext): LintHitDraft[] {
	const prose = matchableText(context.doc);
	const hits: LintHitDraft[] = [];
	let run: OpenedSentence[] = [];
	const closeRun = () => {
		const first = run[0];
		if (first && run.length > rule.max) hits.push(...hitsForFlagged(rule, context, run, first.opener));
		run = [];
	};
	for (const paragraph of context.paragraphs) {
		if (paragraph.kind === "heading" || paragraph.kind === "list-item") {
			closeRun();
			continue;
		}
		for (const sentence of paragraph.sentences) {
			const firstWord = placedWords(prose.slice(sentence.from, sentence.to), sentence.from)[0];
			if (!firstWord) {
				closeRun();
				continue;
			}
			const opener = context.doc.slice(firstWord.from, firstWord.from + firstWord.text.length);
			if (run[0] && run[0].opener.toLowerCase() !== opener.toLowerCase()) closeRun();
			run.push({ range: sentence, paragraph, opener });
		}
	}
	closeRun();
	return rule.scope === "document" ? hits.slice(0, 1) : hits;
}

function isOneSentenceParagraph(paragraph: ParagraphUnit): boolean {
	return paragraph.kind === "paragraph" && paragraph.sentences.length === 1;
}

/** Flags runs of more than `max` one-sentence paragraphs in a row. Headings, lists and quotes break a run. */
function oneSentenceRunHits(rule: MetricRule, context: LintContext): LintHitDraft[] {
	const hits: LintHitDraft[] = [];
	let run: ParagraphUnit[] = [];
	const closeRun = () => {
		if (run.length > rule.max) {
			const flagged = run.map((paragraph) => ({ range: { from: paragraph.from, to: paragraph.to }, paragraph }));
			hits.push(...hitsForFlagged(rule, context, flagged, `${run.length} in a row`));
		}
		run = [];
	};
	for (const paragraph of context.paragraphs) {
		if (isOneSentenceParagraph(paragraph)) run.push(paragraph);
		else closeRun();
	}
	closeRun();
	return rule.scope === "document" ? hits.slice(0, 1) : hits;
}

/** Flags the note when the share of one-sentence paragraphs is above `max`. Needs RATIO_MIN_PARAGRAPHS paragraphs and `minWords` words. */
function oneSentenceRatioHits(rule: MetricRule, context: LintContext): LintHitDraft[] {
	const prose = matchableText(context.doc);
	const paragraphs = context.paragraphs.filter((paragraph) => paragraph.kind === "paragraph");
	if (paragraphs.length < RATIO_MIN_PARAGRAPHS) return [];
	const wordCount = paragraphs.reduce((total, paragraph) => total + placedWords(prose.slice(paragraph.from, paragraph.to), 0).length, 0);
	if (wordCount < (rule.minWords ?? 0)) return [];
	const ratio = paragraphs.filter(isOneSentenceParagraph).length / paragraphs.length;
	if (ratio <= rule.max) return [];
	return [draftHit(rule, documentRange(context), messageFor(rule, `${Math.round(ratio * 100)}% of paragraphs`))];
}
