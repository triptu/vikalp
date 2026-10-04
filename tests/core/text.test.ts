import { describe, expect, it } from "vitest";
import { articleFixBefore, articleFor } from "../../src/core/text/articles";
import { findBlocks, findNonProseRanges } from "../../src/core/text/markdown";
import { countWords, expandToUnit, findSentences, normalizeSpanRange, segmentNote } from "../../src/core/text/segment";

function rangeOf(doc: string, text: string) {
	const from = doc.indexOf(text);
	return { from, to: from + text.length };
}

function sliceOf(doc: string, range: { from: number; to: number } | null) {
	return range ? doc.slice(range.from, range.to) : null;
}

describe("sentences", () => {
	it("Dr. Smith does not split a sentence", () => {
		const text = "Dr. Smith arrived late. He apologised.";
		expect(findSentences(text).map((range) => text.slice(range.from, range.to))).toEqual(["Dr. Smith arrived late.", "He apologised."]);
	});

	it("e.g. inside a sentence keeps it whole", () => {
		const text = "Use plain words, e.g. use instead of utilize. Then stop.";
		expect(findSentences(text)).toHaveLength(2);
	});
});

describe("blocks", () => {
	const doc = [
		"---",
		"title: Draft",
		"---",
		"# The Obvious, the Easy",
		"",
		"First paragraph line one",
		"continues here.",
		"",
		"- a list item",
		"- another item",
		"",
		"```js",
		"const notProse = true;",
		"```",
		"",
		"Last one with `inline code` in it.",
	].join("\n");

	it("finds headings, paragraphs and list items but skips frontmatter and code", () => {
		const blocks = findBlocks(doc).map((block) => [block.kind, doc.slice(block.from, block.to)]);
		expect(blocks).toEqual([
			["heading", "The Obvious, the Easy"],
			["paragraph", "First paragraph line one\ncontinues here."],
			["list-item", "a list item"],
			["list-item", "another item"],
			["paragraph", "Last one with `inline code` in it."],
		]);
	});

	it("marks inline code as non-prose", () => {
		const nonProse = findNonProseRanges(doc).map((range) => doc.slice(range.from, range.to));
		expect(nonProse).toContain("`inline code`");
	});

	it("a heading is one sentence unit", () => {
		const units = segmentNote(doc);
		expect(units[0]?.sentences).toHaveLength(1);
	});
});

describe("span ranges from selections", () => {
	const doc = "Much of the tension in product design comes from balance. It is hard.";

	it("a partial word selection expands to the whole word", () => {
		const selection = { from: doc.indexOf("tensi"), to: doc.indexOf("tensi") + 5 };
		expect(sliceOf(doc, normalizeSpanRange(doc, selection).range)).toBe("tension");
	});

	it("trims whitespace and keeps punctuation outside a word span", () => {
		const selection = rangeOf(doc, " balance. ");
		const result = normalizeSpanRange(doc, selection);
		expect(sliceOf(doc, result.range)).toBe("balance");
		expect(result.unit).toBe("word");
	});

	it("keeps trailing punctuation inside a sentence span", () => {
		const result = normalizeSpanRange(doc, rangeOf(doc, "It is hard."));
		expect(sliceOf(doc, result.range)).toBe("It is hard.");
		expect(result.unit).toBe("sentence");
	});

	it("expanding to sentence and paragraph grows the selection", () => {
		const selection = rangeOf(doc, "tension");
		expect(sliceOf(doc, expandToUnit(doc, selection, "sentence"))).toBe("Much of the tension in product design comes from balance.");
		expect(sliceOf(doc, expandToUnit(doc, selection, "paragraph"))).toBe(doc);
	});

	it("selecting a whole multi-sentence paragraph labels it a paragraph", () => {
		const twoParagraphs = `${doc}\n\nNext paragraph.`;
		expect(normalizeSpanRange(twoParagraphs, { from: 0, to: doc.length }).unit).toBe("paragraph");
	});
});

describe("a/an", () => {
	it.each([
		["eraser", "an"],
		["thumbtack", "a"],
		["hour", "an"],
		["unicorn", "a"],
		["one-off", "a"],
		["umbrella", "an"],
		["FBI", "an"],
		["European", "a"],
		["honest", "an"],
		["user", "a"],
	])("%s takes %s", (word, article) => {
		expect(articleFor(word)).toBe(article);
	});

	it("a → an when the next version starts with a vowel sound", () => {
		const doc = "like a thumbtack, for example";
		const fix = articleFixBefore(doc, doc.indexOf("thumbtack"), "eraser");
		expect(fix).toEqual({ from: 5, to: 6, insert: "an" });
	});

	it("keeps capitalisation of the article", () => {
		const doc = "An eraser works.";
		expect(articleFixBefore(doc, 3, "pencil")).toEqual({ from: 0, to: 2, insert: "A" });
	});

	it("does nothing when the article already fits or there is none", () => {
		expect(articleFixBefore("an hour", 3, "owl")).toBeNull();
		expect(articleFixBefore("the thumbtack", 4, "eraser")).toBeNull();
		expect(articleFixBefore("banana split", 7, "eraser")).toBeNull();
	});
});

describe("word count", () => {
	it("counts words, not punctuation", () => {
		expect(countWords("The Obvious, the Easy — and the Possible!")).toBe(7);
	});
});
