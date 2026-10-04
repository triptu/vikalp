const WORD_CHAR = String.raw`[\p{L}\p{N}_]`;
const BEFORE_WORD = `(?<!${WORD_CHAR})(?<!${WORD_CHAR}['-])`;
const AFTER_WORD = `(?!${WORD_CHAR})(?!['-]${WORD_CHAR})`;
const STARTS_WITH_WORD_CHAR = /^[\p{L}\p{N}_]/u;
const ENDS_WITH_WORD_CHAR = /[\p{L}\p{N}_]$/u;

/** Trims, collapses whitespace and straightens curly quotes. */
export function normalizePhrase(text: string): string {
	return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim().replace(/\s+/g, " ");
}

/**
 * One regular expression that finds any of the phrases as whole words: "use"
 * does not match inside "user" or "re-use", spaces match any whitespace, and a
 * hyphen matches a hyphen, a space or nothing ("game-changer", "game changer").
 * Longer phrases win when two start at the same place. Expects text with
 * straight quotes (see `matchableText`).
 */
export function phraseRegex(phrases: string[], ignorecase: boolean): RegExp | null {
	const distinct = [...new Set(phrases.map(normalizePhrase).filter((phrase) => phrase !== ""))];
	if (distinct.length === 0) return null;
	const longestFirst = distinct.sort((a, b) => b.length - a.length);
	return new RegExp(longestFirst.map(phrasePattern).join("|"), ignorecase ? "giu" : "gu");
}

function phrasePattern(phrase: string): string {
	const body = escapeRegex(phrase).replace(/-/g, String.raw`[-\s]?`).replace(/ /g, String.raw`\s+`);
	const before = STARTS_WITH_WORD_CHAR.test(phrase) ? BEFORE_WORD : "";
	const after = ENDS_WITH_WORD_CHAR.test(phrase) ? AFTER_WORD : "";
	return before + body + after;
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** A lookup key that treats two spellings of one phrase as equal, whatever the case, spacing, hyphens or quotes. */
export function phraseKey(text: string, ignorecase: boolean): string {
	const key = normalizePhrase(text).replace(/[-\s]/g, "");
	return ignorecase ? key.toLowerCase() : key;
}

/**
 * Compiles a pattern from a rule file. Tries Unicode mode first so `\p{...}`
 * works, then plain mode for patterns that are only valid there. Throws if
 * neither compiles.
 */
export function compileRulePattern(source: string, ignorecase: boolean): RegExp {
	const flags = ignorecase ? "gi" : "g";
	try {
		return new RegExp(source, `${flags}u`);
	} catch {
		return new RegExp(source, flags);
	}
}
