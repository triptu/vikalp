import type { TextRange } from "../model/types";
import { findNonProseRanges } from "../text/markdown";

const LINK_TARGETS = /\]\([^)\n]*\)|<?https?:\/\/[^\s>)]+>?/g;

let lastNote: string | null = null;
let lastMatchable = "";

/**
 * The note as local rules read it. Same length and offsets as the note, with
 * code, frontmatter, comments, link targets and URLs blanked to spaces, and
 * curly quotes made straight so "it’s" and "it's" match the same rules.
 */
export function matchableText(doc: string): string {
	if (doc === lastNote) return lastMatchable;
	const characters = doc.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').split("");
	for (const range of [...findNonProseRanges(doc), ...rangesMatching(doc, LINK_TARGETS)]) {
		for (let index = range.from; index < range.to; index++) {
			if (characters[index] !== "\n") characters[index] = " ";
		}
	}
	lastNote = doc;
	lastMatchable = characters.join("");
	return lastMatchable;
}

function rangesMatching(doc: string, pattern: RegExp): TextRange[] {
	return [...doc.matchAll(pattern)].map((match) => ({ from: match.index, to: match.index + match[0].length }));
}
