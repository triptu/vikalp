import { NOT_ADVERBS, STOPWORDS } from "./data/english";

const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });

export interface PlacedWord {
	text: string;
	from: number;
}

/** The words in `text` with their offsets, shifted by `base`. */
export function placedWords(text: string, base: number): PlacedWord[] {
	const found: PlacedWord[] = [];
	for (const segment of wordSegmenter.segment(text)) {
		if (segment.isWordLike) found.push({ text: segment.segment, from: base + segment.index });
	}
	return found;
}

export function letterCount(word: string): number {
	return word.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

/**
 * Estimated English syllables. Counts vowel groups, then corrects the common
 * cases: silent final "e" (but not "-le"), silent "-es" and "-ed", "y" before a
 * vowel acting as a consonant, silent "e" inside words ("every",
 * "something", "statement"), and vowel pairs that split ("ob-vi-ous", "be-ing"). Good enough to tell short words from long ones.
 */
export function countSyllables(word: string): number {
	const original = word.toLowerCase().replace(/'s$/, "").replace(/[^a-z]/g, "");
	if (original.length === 0) return 0;
	if (original.length <= 3) return 1;

	let letters = original;
	if (/es$/.test(letters) && !/(?:[sxzcg]|[cs]h)es$/.test(letters)) letters = letters.slice(0, -1);
	if (/ed$/.test(letters) && !/(?:[td]|ee)ed$/.test(letters)) letters = letters.slice(0, -2);
	else if (/e$/.test(letters) && !/[^aeiouy]le$/.test(letters)) letters = letters.slice(0, -1);
	letters = letters.replace(/y(?=[aeiou])/g, "_");

	const vowelGroups = letters.match(/[aeiouy]+/g)?.length ?? 0;
	const splitPairs = original.match(/[^cgstxl]i[aou](?!n$)/g)?.length ?? 0;
	const vowelBeforeIng = /[aeiou]ing$/.test(original) ? 1 : 0;
	const ism = /ism$/.test(original) ? 1 : 0;
	const silentMiddleE = /(?:^|[^aeiou])every|^some[^aeiouy]|[^aeiou]e(?:ment|ful|less|ly|ness)/.test(original) ? 1 : 0;
	return Math.max(1, vowelGroups + splitPairs + vowelBeforeIng + ism - silentMiddleE);
}

/** True for a word that reads as an "-ly" adverb ("quickly", "really"). Capitalized words mid-sentence are taken as names. */
export function isLyAdverb(word: string, startsSentence: boolean): boolean {
	if (!/^\p{L}+$/u.test(word)) return false;
	const lower = word.toLowerCase();
	if (lower.length < 4 || !lower.endsWith("ly")) return false;
	if (!startsSentence && word[0] !== lower[0]) return false;
	return !NOT_ADVERBS.has(lower);
}

/**
 * The form of a word used to spot repetition: lower case, no possessive, no
 * plural "s". Null for short words, stopwords and anything that is not a word.
 */
export function contentStem(word: string): string | null {
	const lower = word.toLowerCase().replace(/'s$/, "");
	if (lower.length < 4 || !/^\p{L}+$/u.test(lower) || STOPWORDS.has(lower)) return null;
	const singular = lower.length > 4 && lower.endsWith("s") && !/(?:ss|us|is)$/.test(lower) ? lower.slice(0, -1) : lower;
	return STOPWORDS.has(singular) ? null : singular;
}
