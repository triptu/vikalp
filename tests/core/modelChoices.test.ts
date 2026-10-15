import { describe, expect, it } from "vitest";
import { familyChoices, pickOpenModels, type OpenRouterModelInfo } from "../../src/core/modelChoices";

const named = (ids: string[]) => ids.map((id) => ({ id, name: id }));

describe("suggested models for each mode", () => {
	const openRouter = named([
		"openai/gpt-5.6-luna",
		"openai/gpt-6-luna",
		"openai/gpt-6-luna-pro",
		"openai/gpt-6-luna:batch",
		"~openai/gpt-luna-latest",
		"anthropic/claude-haiku-4.5",
		"anthropic/claude-haiku-5.5",
		"anthropic/claude-haiku-5.5:batch",
		"openai/gpt-6-sol",
		"openai/gpt-6.1-sol",
		"anthropic/claude-sonnet-5.5",
		"openai/gpt-6-astra",
		"anthropic/claude-opus-5",
		"anthropic/claude-opus-5.5",
		"anthropic/claude-fable-5",
		"anthropic/claude-fable-5.1",
	]);

	it("Lite offers only the newest Luna and Haiku, without pro, batch or alias variants", () => {
		expect(familyChoices(openRouter, "lite").map((model) => model.id)).toEqual(["openai/gpt-6-luna", "anthropic/claude-haiku-5.5"]);
	});

	it("Medium offers the newest Sol and Sonnet, and Heavy the newest Astra, Opus and Fable", () => {
		expect(familyChoices(openRouter, "medium").map((model) => model.id)).toEqual(["openai/gpt-6.1-sol", "anthropic/claude-sonnet-5.5"]);
		expect(familyChoices(openRouter, "heavy").map((model) => model.id)).toEqual(["openai/gpt-6-astra", "anthropic/claude-opus-5.5", "anthropic/claude-fable-5.1"]);
	});

	it("works with Anthropic's own ids, and leaves out families a provider doesn't have", () => {
		const anthropic = named(["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-haiku-5-5", "claude-opus-5-5", "claude-fable-5-1"]);
		expect(familyChoices(anthropic, "lite").map((model) => model.id)).toEqual(["claude-haiku-5-5"]);
		expect(familyChoices(anthropic, "heavy").map((model) => model.id)).toEqual(["claude-opus-5-5", "claude-fable-5-1"]);
	});
});

describe("open models suggested on OpenRouter", () => {
	const model = (id: string, outputPrice: number, extra: Partial<OpenRouterModelInfo> = {}): OpenRouterModelInfo => ({
		id,
		canonicalSlug: `${id.replace(/:.*/, "")}-2026`,
		name: `Maker: ${id}`,
		huggingFaceId: `org/${id}`,
		supportsTools: true,
		outputPrice,
		...extra,
	});
	const models = [
		model("smart/pro", 0.9),
		model("smart/pro:batch", 0.45),
		model("big/heavy", 2),
		model("big/costly", 11),
		model("fast/flash", 0.2),
		model("fast/mini", 0.3),
		model("cheap/tiny", 0.1),
		model("cheap/tiny-exp", 0.1),
		model("closed/best", 0.5, { huggingFaceId: null }),
		model("chatty/no-tools", 0.2, { supportsTools: false }),
	];
	const scores = [
		{ slug: "closed/best-2026", intelligence: 60 },
		{ slug: "smart/pro-2026", intelligence: 50 },
		{ slug: "big/heavy-2026", intelligence: 48 },
		{ slug: "big/costly-2026", intelligence: 47 },
		{ slug: "chatty/no-tools-2026", intelligence: 46 },
		{ slug: "fast/flash-2026", intelligence: 45 },
		{ slug: "fast/mini-2026", intelligence: 40 },
		{ slug: "cheap/tiny-exp-2026", intelligence: 35 },
		{ slug: "cheap/tiny-2026", intelligence: 30 },
	];

	it("Heavy gets the two smartest open models, Medium the next under its price, Lite the best cheap ones", () => {
		const picks = pickOpenModels(scores, models);
		expect(picks.heavy.map((pick) => pick.id)).toEqual(["smart/pro", "big/heavy"]);
		expect(picks.medium.map((pick) => pick.id)).toEqual(["fast/flash", "fast/mini"]);
		expect(picks.lite.map((pick) => pick.id)).toEqual(["cheap/tiny"]);
	});

	it("skips closed models, models without tool calls, batch variants and experimental models, and shows short names", () => {
		const picks = pickOpenModels(scores, models);
		const all = [...picks.lite, ...picks.medium, ...picks.heavy];
		expect(all.map((pick) => pick.id)).not.toContain("closed/best");
		expect(all.map((pick) => pick.id)).not.toContain("chatty/no-tools");
		expect(all.map((pick) => pick.id)).not.toContain("smart/pro:batch");
		expect(all.map((pick) => pick.id)).not.toContain("cheap/tiny-exp");
		expect(picks.heavy[0]?.name).toBe("smart/pro");
	});
});
