import type { TextRange } from "../model/types";

/**
 * Ranges of a markdown note that are not prose: frontmatter, fenced code,
 * math blocks, HTML and Obsidian comments, and inline code. Spans, lint and
 * AI passes never look inside these.
 */
export function findNonProseRanges(doc: string): TextRange[] {
	const ranges: TextRange[] = [];
	const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(doc);
	if (frontmatter) ranges.push({ from: 0, to: frontmatter[0].length });

	const blockPatterns = [
		/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm,
		/\$\$[\s\S]*?\$\$/g,
		/<!--[\s\S]*?-->/g,
		/%%[\s\S]*?%%/g,
	];
	for (const pattern of blockPatterns) {
		for (const match of doc.matchAll(pattern)) {
			ranges.push({ from: match.index, to: match.index + match[0].length });
		}
	}
	for (const match of doc.matchAll(/(`+)(?!`)[^\n]*?[^`]\1(?!`)/g)) {
		ranges.push({ from: match.index, to: match.index + match[0].length });
	}
	return mergeRanges(ranges);
}

export function mergeRanges(ranges: TextRange[]): TextRange[] {
	const sorted = [...ranges].sort((a, b) => a.from - b.from);
	const merged: TextRange[] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
		else merged.push({ ...range });
	}
	return merged;
}

export function overlapsAny(range: TextRange, others: TextRange[]): boolean {
	return others.some((other) => range.from < other.to && other.from < range.to);
}

const BLOCK_PREFIX = /^(\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+(?:\[[ xX]\]\s+)?))+/;

export interface Block {
	/** Range of the block's prose, after markdown prefixes like `# ` or `- `. */
	from: number;
	to: number;
	kind: "heading" | "paragraph" | "list-item" | "quote";
}

/**
 * Splits a note into prose blocks. Blank lines end a block; a heading, list
 * item or quote line always starts a new one. Non-prose ranges are skipped.
 */
export function findBlocks(doc: string): Block[] {
	const nonProse = findNonProseRanges(doc);
	const blocks: Block[] = [];
	let current: Block | null = null;
	let lineStart = 0;

	const closeCurrent = () => {
		if (current && current.to > current.from) blocks.push(current);
		current = null;
	};

	while (lineStart <= doc.length) {
		const newline = doc.indexOf("\n", lineStart);
		const lineEnd = newline === -1 ? doc.length : newline;
		const line = doc.slice(lineStart, lineEnd);
		const lineRange = { from: lineStart, to: lineEnd };
		const insideNonProse = nonProse.some((range) => range.from <= lineRange.from && lineRange.to <= range.to);

		if (line.trim() === "" || insideNonProse || /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line) || /^\s*\|/.test(line)) {
			closeCurrent();
		} else {
			const prefix = BLOCK_PREFIX.exec(line)?.[0] ?? "";
			const kind: Block["kind"] = /#/.test(prefix)
				? "heading"
				: /[-*+]|\d/.test(prefix)
					? "list-item"
					: />/.test(prefix)
						? "quote"
						: "paragraph";
			const textFrom = lineStart + prefix.length;
			const textTo = lineStart + line.trimEnd().length;
			const continues = current !== null && prefix === "" && (current).kind !== "heading";
			if (continues && current) {
				current.to = textTo;
			} else {
				closeCurrent();
				current = { from: textFrom, to: textTo, kind };
				if (kind === "heading") closeCurrent();
			}
		}
		if (newline === -1) break;
		lineStart = newline + 1;
	}
	closeCurrent();
	return blocks;
}
