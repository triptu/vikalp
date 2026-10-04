import { describe, expect, it } from "vitest";
import { acceptableAlternatives, placeQuotes, selectToTarget } from "../../src/core/ai/placement";
import { alternativesPrompt } from "../../src/core/ai/prompts/alternatives";
import { numberSentences, renderNumbered } from "../../src/core/ai/units";
import { createSpanMeta } from "../../src/core/model/span";

const note = "# Title\n\nMuch of the tension comes from balance. It is, in a way, sort of hard.\n\nThe end is here. The end is here.";

describe("numbered sentences", () => {
	it("gives each sentence an id and keeps paragraphs apart", () => {
		const sentences = numberSentences(note);
		expect(sentences.map((sentence) => sentence.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
		expect(renderNumbered(sentences)).toBe("[s1] Title\n\n[s2] Much of the tension comes from balance.\n[s3] It is, in a way, sort of hard.\n\n[s4] The end is here.\n[s5] The end is here.");
	});
});

describe("placing model quotes", () => {
	const sentences = numberSentences(note);

	it("a trim proposal that does not exist verbatim is rejected", () => {
		const { placed, rejected } = placeQuotes(note, sentences, [{ unit_id: "s3", quote: "kind of hard", extra: null }]);
		expect(placed).toHaveLength(0);
		expect(rejected).toBe(1);
	});

	it("uses the sentence id to choose between identical sentences", () => {
		const { placed } = placeQuotes(note, sentences, [{ unit_id: "s5", quote: "The end is here.", extra: null }]);
		expect(placed[0]!.from).toBe(note.lastIndexOf("The end is here."));
	});

	it("overlapping proposals keep the first", () => {
		const { placed, rejected } = placeQuotes(note, sentences, [
			{ unit_id: "s3", quote: ", in a way,", extra: "a" },
			{ unit_id: "s3", quote: "in a way, sort of", extra: "b" },
		]);
		expect(placed.map((quote) => quote.extra)).toEqual(["a"]);
		expect(rejected).toBe(1);
	});

	it("tolerates the model wrapping a quote in quotation marks", () => {
		const { placed } = placeQuotes(note, sentences, [{ unit_id: "s3", quote: "“sort of”", extra: null }]);
		expect(note.slice(placed[0]!.from, placed[0]!.to)).toBe("sort of");
	});
});

describe("AI alternatives", () => {
	it("drops duplicates of existing versions, empties and list markers, and caps the count", () => {
		const span = createSpanMeta("tension", "word");
		expect(acceptableAlternatives(span, ["Tension", "", "1. pressure", "strain", "pressure", "friction", "unease"], 3)).toEqual(["pressure", "strain", "friction"]);
	});

	it("the prompt includes the paragraph context and the writer's own versions", () => {
		const prompt = alternativesPrompt({
			noteTitle: "Essay",
			unit: "word",
			spanText: "tension",
			paragraphWithMarker: "Much of the ⟦tension⟧ comes from balance.",
			previousParagraph: "",
			nextParagraph: "Next.",
			existingVersions: ["tension", "pressure"],
			count: 5,
		});
		expect(prompt).toContain("⟦tension⟧");
		expect(prompt).toContain("- pressure");
		expect(prompt).toContain("Give 5 alternatives.");
	});
});

describe("trim targets", () => {
	it("keeps the most expendable cuts until the target is met, without overshooting", () => {
		const proposals = [
			{ id: "a", words: 30, rank: 2 },
			{ id: "b", words: 5, rank: 0 },
			{ id: "c", words: 12, rank: 1 },
			{ id: "d", words: 4, rank: 3 },
		];
		expect(selectToTarget(proposals, 20).map((proposal) => proposal.id)).toEqual(["b", "c", "d"]);
	});
});
