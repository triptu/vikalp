import type { TextRange } from "../model/types";

const VOWEL_SOUND_EXCEPTIONS = /^(hour|honest|honou?r|heir|herb(?!al)|homage)/i;
const CONSONANT_SOUND_EXCEPTIONS = /^(uni(?!nt|mp|nh|nf|ns|nd|nl|nr|nw|nv)|use|usu|ura|uro|uti|ute|ewe|eu|one(?![a-z])|once|onc|ubiq|ufo|uk(?![a-z])|us(?![a-z])|wh?o(?=le|re)|yu)/i;
/** Letters whose names start with a vowel sound when read as an initialism ("an FBI agent"). */
const VOWEL_LETTER_NAMES = /^[aefhilmnorsx]$/i;

/** The indefinite article that fits before `word`, using its first sound. */
export function articleFor(word: string): "a" | "an" {
	const cleaned = word.replace(/^[^\p{L}\p{N}]+/u, "");
	if (cleaned === "") return "a";
	if (/^[A-Z]{2,}\b/.test(cleaned)) return VOWEL_LETTER_NAMES.test(cleaned[0] ?? "") ? "an" : "a";
	if (/^8|^11(?!\d\d)|^18(?!\d\d)/.test(cleaned)) return "an";
	if (VOWEL_SOUND_EXCEPTIONS.test(cleaned)) return "an";
	if (CONSONANT_SOUND_EXCEPTIONS.test(cleaned)) return "a";
	return /^[aeiou]/i.test(cleaned) ? "an" : "a";
}

export interface ArticleFix extends TextRange {
	insert: string;
}

/**
 * When the text at `spanFrom` is about to become `nextText`, returns the edit
 * that fixes a preceding "a"/"an" to match, or null when nothing needs fixing.
 */
export function articleFixBefore(doc: string, spanFrom: number, nextText: string): ArticleFix | null {
	const before = doc.slice(Math.max(0, spanFrom - 4), spanFrom);
	const match = /(?:^|[^\p{L}])([Aa]n?)(\s+)$/u.exec(before);
	if (!match) return null;
	const article = match[1] ?? "";
	const spacing = match[2] ?? "";
	const firstWord = /^\S+/.exec(nextText.trimStart())?.[0] ?? "";
	if (firstWord === "") return null;
	const wanted = articleFor(firstWord);
	if (article.toLowerCase() === wanted) return null;
	const replacement = article[0] === "A" ? wanted[0]?.toUpperCase() + wanted.slice(1) : wanted;
	const from = spanFrom - spacing.length - article.length;
	return { from, to: from + article.length, insert: replacement };
}
