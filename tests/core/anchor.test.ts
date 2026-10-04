import { describe, expect, it } from "vitest";
import { findQuote, makeAnchor, resolveAnchor } from "../../src/core/anchor/anchor";

const essay =
	"Much of the tension in product development and interface design comes from trying to balance the obvious, the easy, and the possible. " +
	"Figuring out which things go in which position is critical to fully understanding how to make something useful.";

function anchorFor(doc: string, text: string, occurrence = 0) {
	let from = -1;
	for (let index = 0; index <= occurrence; index++) from = doc.indexOf(text, from + 1);
	return makeAnchor(doc, { from, to: from + text.length });
}

function resolvedText(doc: string, anchor: ReturnType<typeof makeAnchor>) {
	const range = resolveAnchor(doc, anchor);
	return range ? { text: doc.slice(range.from, range.to), from: range.from } : null;
}

describe("anchoring", () => {
	it("a span survives inserting a paragraph above it", () => {
		const anchor = anchorFor(essay, "tension");
		const edited = `A new opening paragraph goes here.\n\n${essay}`;
		expect(resolvedText(edited, anchor)).toEqual({ text: "tension", from: edited.indexOf("tension") });
	});

	it("a span survives a typo fixed inside its prefix", () => {
		const doc = essay.replace("product", "prodcut");
		const anchor = anchorFor(doc, "development");
		const fixed = essay;
		expect(resolvedText(fixed, anchor)?.text).toBe("development");
	});

	it("a span is orphaned when its text is removed", () => {
		const anchor = anchorFor(essay, "critical to fully understanding");
		const edited = essay.replace("critical to fully understanding", "key to grasping");
		expect(resolveAnchor(edited, anchor)).toBeNull();
	});

	it("two identical words disambiguate by context", () => {
		const anchor = anchorFor(essay, "the", 3);
		const expectedContext = essay.slice(anchor.start - 10, anchor.end + 10);
		const edited = `Intro.\n\n${essay}`;
		const range = resolveAnchor(edited, anchor);
		expect(range).not.toBeNull();
		expect(edited.slice(range!.from - 10, range!.to + 10)).toBe(expectedContext);
	});

	it("a lightly edited sentence is found by fuzzy matching", () => {
		const anchor = anchorFor(essay, "Figuring out which things go in which position is critical");
		const edited = essay.replace("Figuring out which things go in which position", "Figuring out what things go in which position");
		expect(resolvedText(edited, anchor)?.text).toContain("Figuring out what things go");
	});
});

describe("quote validation", () => {
	it("a proposal that does not exist verbatim is rejected", () => {
		expect(findQuote(essay, "the hard and the possible")).toBeNull();
	});

	it("finds a quote and prefers the hint range", () => {
		const doc = "The easy part. The easy part again.";
		const second = doc.lastIndexOf("easy part");
		expect(findQuote(doc, "easy part", { within: { from: 15, to: doc.length } })?.from).toBe(second);
	});

	it("tolerates curly versus straight quotes", () => {
		const doc = "It’s not obvious.";
		expect(findQuote(doc, "It's not")).toEqual({ from: 0, to: 8 });
	});
});

describe("anchoring prefers an orphan to a wrong guess", () => {
	it("a ghosted word that was removed does not jump to the same word elsewhere", () => {
		const doc = "I just think so. It was just fine.";
		const anchor = makeAnchor(doc, { from: 2, to: 6 });
		const edited = "I think so. It was just fine.";
		expect(resolveAnchor(edited, anchor)).toBeNull();
	});

	it("an orphan saved without context is not re-placed on a common word", () => {
		const anchor = { start: -1, end: -1, exact: "the", prefix: "", suffix: "" };
		expect(resolveAnchor(essay, anchor)).toBeNull();
	});

	it("a long orphan saved without context is re-placed when its text is unique", () => {
		const exact = "Figuring out which things go in which position";
		const anchor = { start: -1, end: -1, exact, prefix: "", suffix: "" };
		expect(resolveAnchor(essay, anchor)?.from).toBe(essay.indexOf(exact));
	});
});
