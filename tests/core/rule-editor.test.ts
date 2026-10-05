import { describe, expect, it } from "vitest";
import { BUILTIN_RULES } from "../../src/core/rules/builtin";
import { draftFromRule, emptyDraft, newRuleId, ruleFromDraft } from "../../src/core/rules/draft";
import { groupRulesByLabel } from "../../src/core/rules/groups";
import { runLocalRules } from "../../src/core/rules/run";

describe("rule families", () => {
	it("built-in checks that share a label show as one family", () => {
		const families = groupRulesByLabel(BUILTIN_RULES);
		const hedging = families.find((family) => family.label === "Hedging");
		expect(hedging?.rules.length).toBeGreaterThan(1);
		expect(new Set(families.map((family) => family.label)).size).toBe(families.length);
		expect(hedging?.description).toMatch(/soften/i);
	});
});

describe("the rule editor form", () => {
	it("every built-in rule survives a round trip through the form unchanged", () => {
		for (const rule of BUILTIN_RULES) {
			const result = ruleFromDraft(draftFromRule(rule));
			expect(result.ok, `${rule.id}: ${result.ok ? "" : result.errors.join("; ")}`).toBe(true);
			if (result.ok) expect({ ...result.rule, origin: rule.origin }).toEqual(rule);
		}
	});

	it("a new phrase rule written in the form flags its phrases", () => {
		const draft = { ...emptyDraft("my.corporate"), label: "Corporate speak", phrases: "synergy\ncircle back\n\n", message: "Corporate: '%s'" };
		const result = ruleFromDraft(draft);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const hits = runLocalRules([result.rule], "Let's circle back on the synergy.");
		expect(hits.map((hit) => hit.message)).toEqual(["Corporate: 'circle back'", "Corporate: 'synergy'"]);
	});

	it("phrases with fixes read one 'phrase → fix' per line, and an empty fix means cut it", () => {
		const draft = { ...emptyDraft("my.plain"), label: "Plain", engine: "substitution" as const, fixes: "utilize → use\nin order to -> to\nvery →" };
		const result = ruleFromDraft(draft);
		expect(result.ok && result.rule.engine === "substitution" && result.rule.swap).toEqual({ utilize: "use", "in order to": "to", very: "" });
	});

	it("reports problems the way a rule file would", () => {
		const result = ruleFromDraft({ ...emptyDraft("my.broken"), engine: "regex", patterns: "(unclosed" });
		expect(result.ok).toBe(false);
		expect(!result.ok && result.errors.join(" ")).toMatch(/pattern/i);
	});

	it("new rule ids come from the label and never collide", () => {
		expect(newRuleId("Pet peeves!", new Set())).toBe("my.pet-peeves");
		expect(newRuleId("Pet peeves", new Set(["my.pet-peeves"]))).toBe("my.pet-peeves-2");
	});
});
