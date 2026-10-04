import { describe, expect, it } from "vitest";
import { BUILTIN_RULE_FILES, BUILTIN_RULES } from "../../src/core/rules/builtin";
import { parseRule, serializeRule } from "../../src/core/rules/parse";
import { judgmentTasks, runLocalRules } from "../../src/core/rules/run";
import type { LintHitDraft, Rule } from "../../src/core/rules/types";

function hitsWithLabel(label: string, doc: string): LintHitDraft[] {
	return runLocalRules(BUILTIN_RULES, doc).filter((hit) => hit.label === label);
}

function flaggedText(label: string, doc: string): string[] {
	return hitsWithLabel(label, doc).map((hit) => doc.slice(hit.from, hit.to));
}

function wordlist(tokens: string[], overrides: Partial<Rule> = {}): Rule {
	return { id: "test.words", label: "Test", scope: "sentence", engine: "wordlist", severity: "warning", tokens, ...overrides } as Rule;
}

function textsOf(rule: Rule, doc: string): string[] {
	return runLocalRules([rule], doc).map((hit) => doc.slice(hit.from, hit.to));
}

function repeatSentence(sentence: string, times: number): string {
	return Array.from({ length: times }, () => sentence).join(" ");
}

const CLEAN_SENTENCE = "Much of the tension in product development comes from trying to balance the obvious, the easy, and the possible.";

const CLEAN_ESSAY = `# The obvious, the easy, the possible

${CLEAN_SENTENCE} Teams rarely argue about what the user wants. They argue about what to build first, and how much of it to build before anyone sees it.

The obvious idea is the one everyone already agrees on. It feels safe, so it tends to win early meetings. The easy idea is the one the codebase allows today. It ships fast and teaches you little. The possible idea is the one that needs a leap, and nobody can tell yet whether the leap will land.

Good teams keep all three on the table for longer than feels comfortable. They write down what each option would prove if it worked. Then they pick the cheapest experiment that could change their minds. Sometimes the obvious idea survives that test. Often it does not.

I learned this the slow way. My first product shipped every feature our customers asked for, and almost nobody used them. We had built a list, not a tool. The second time, we cut the list in half and watched people work for a week before writing any code. That week saved us months.

None of this needs a framework. It needs a habit of asking one question before each decision: what would we learn if this went wrong? When the answer is "nothing," the plan is too safe. When the answer is "everything," it is probably too big. The right next step usually sits between those two answers, and it is often smaller than you expect.`;

describe("plain, good prose stays quiet", () => {
	it("a clear essay sentence gets no hits from any rule", () => {
		expect(runLocalRules(BUILTIN_RULES, CLEAN_SENTENCE)).toEqual([]);
	});

	it("a 300-word plain essay gets at most two hits", () => {
		const hits = runLocalRules(BUILTIN_RULES, CLEAN_ESSAY);
		expect(hits.length).toBeLessThanOrEqual(2);
	});
});

describe("Hedging", () => {
	it.each([
		["I think we should ship on Friday.", "I think"],
		["This is probably the best option.", "probably"],
		["It seems the cache is stale.", "It seems"],
		["Perhaps the answer is simpler.", "Perhaps"],
		["In my opinion, the plan is too big.", "In my opinion"],
		["The fix is kind of fragile.", "kind of"],
		["In a way, the bug helped us.", "In a way"],
		["Studies show that people read less online.", "Studies show"],
		["Experts agree this approach works.", "Experts agree"],
	])("flags %j", (doc, expected) => {
		expect(flaggedText("Hedging", doc)).toContain(expected);
	});

	it.each([
		"We should ship on Friday.",
		"What kind of tool do you need?",
		"This kind of bug is rare.",
		"Write it in a way that a new hire can follow.",
		"The user may cancel at any time.",
		"We sort the files by date.",
	])("leaves %j alone", (doc) => {
		expect(hitsWithLabel("Hedging", doc)).toEqual([]);
	});

	it("asks the judgment question about every sentence", () => {
		const doc = "We shipped. It might work.";
		const hedgeTasks = judgmentTasks(BUILTIN_RULES, doc).filter((task) => task.rule.id === "hedging");
		expect(hedgeTasks.map((task) => task.unit.text)).toEqual(["We shipped.", "It might work."]);
		expect(hedgeTasks[0]?.question).toMatch(/\?$/);
	});
});

describe("Wordy", () => {
	it.each([
		["In order to ship, we cut scope.", "In order to"],
		["We utilize three servers.", "utilize"],
		["Due to the fact that it rained, we stayed in.", "Due to the fact that"],
		["At this point in time we have no plan.", "At this point in time"],
		["She basically rewrote the whole thing.", "basically"],
	])("flags %j", (doc, expected) => {
		expect(flaggedText("Wordy", doc)).toContain(expected);
	});

	it("flags a sentence over 35 words", () => {
		const doc = `${repeatSentence("we kept adding one more step", 6).replace(/ we/g, ", and we")}.`;
		expect(hitsWithLabel("Wordy", doc).map((hit) => hit.message)).toContainEqual(expect.stringMatching(/^Long sentence \(\d+ words\)/));
	});

	it.each(["We cut scope to ship.", "The utility bill arrived.", "The order arrived late.", "It rained, so we stayed in."])("leaves %j alone", (doc) => {
		expect(hitsWithLabel("Wordy", doc)).toEqual([]);
	});

	it("suggests the plain word and keeps the capital letter", () => {
		const [hit] = hitsWithLabel("Wordy", "In order to win, rest.");
		expect(hit?.suggestion).toBe("To");
		expect(hit?.message).toBe("Wordy: 'In order to'. Try 'To'.");
	});

	it("suggests cutting a phrase whose replacement is empty", () => {
		const [hit] = hitsWithLabel("Wordy", "It should be noted that we won.");
		expect(hit?.suggestion).toBe("");
		expect(hit?.message).toContain("Try cutting it.");
	});
});

describe("Verbose", () => {
	it("flags a paragraph over 250 words and covers the whole paragraph", () => {
		const paragraph = repeatSentence("The team met again to talk about the plan for next week.", 22);
		const doc = `Intro line.\n\n${paragraph}`;
		const [hit] = hitsWithLabel("Verbose", doc);
		expect(hit && doc.slice(hit.from, hit.to)).toBe(paragraph);
		expect(hit?.scope).toBe("paragraph");
	});

	it("leaves a normal paragraph alone", () => {
		expect(hitsWithLabel("Verbose", CLEAN_ESSAY)).toEqual([]);
	});
});

describe("Complicated", () => {
	it.each([
		"Interdisciplinary collaboration fundamentally necessitates institutional acknowledgement of methodological heterogeneity across organizational boundaries and departments.",
		"Organizational transformation necessitates comprehensive stakeholder engagement across multiple departments.",
	])("flags %j", (doc) => {
		expect(hitsWithLabel("Complicated", doc).length).toBeGreaterThan(0);
	});

	it.each([
		CLEAN_SENTENCE,
		"Deleting the active version activates the previous one.",
		"We cut the list in half and watched people work for a week before writing any code.",
	])("leaves %j alone", (doc) => {
		expect(hitsWithLabel("Complicated", doc)).toEqual([]);
	});
});

describe("AI-sounding", () => {
	it.each([
		["Let's delve into the details.", "delve"],
		["Our city is a tapestry of cultures.", "tapestry"],
		["It's important to note that results vary.", "It's important to note"],
		["In today's fast-paced world, attention is scarce.", "In today's fast-paced world"],
		["It's not just a tool, it's a mindset.", "not just a tool, it's"],
		["The festival grew, highlighting the town's appeal.", "highlighting the"],
		["Her work serves as a reminder that craft matters.", "serves as a reminder"],
	])("flags %j", (doc, expected) => {
		expect(flaggedText("AI-sounding", doc).join(" | ")).toContain(expected);
	});

	it("flags a paragraph crowded with em dashes", () => {
		const doc = "The plan — such as it was — fell apart. The team — tired and late — shipped anyway.";
		expect(hitsWithLabel("AI-sounding", doc).map((hit) => hit.ruleId)).toContain("ai-sounding.em-dashes");
	});

	it.each([
		"We dug into the details.",
		"She wove a rug from old shirts.",
		"It's not ready yet.",
		"Not just anyone can do it.",
		"The report, highlighted in yellow, was late.",
		"Two dashes — like this — are fine in a short paragraph.",
	])("leaves %j alone", (doc) => {
		expect(hitsWithLabel("AI-sounding", doc)).toEqual([]);
	});

	it("asks whether each paragraph reads like AI text", () => {
		const doc = "First paragraph.\n\nSecond paragraph. With two sentences.";
		const tasks = judgmentTasks(BUILTIN_RULES, doc).filter((task) => task.rule.id === "ai-sounding.paragraph");
		expect(tasks.map((task) => task.unit.text)).toEqual(["First paragraph.", "Second paragraph. With two sentences."]);
	});
});

describe("LinkedIn voice", () => {
	it.each([
		["Here's what I learned.", "Here's what I learned"],
		["Let that sink in.", "Let that sink in"],
		["I'm humbled to start a new role.", "I'm humbled"],
		["Unpopular opinion: meetings are fine.", "Unpopular opinion"],
		["Agree?", "Agree?"],
		["Thoughts?", "Thoughts?"],
		["The result? We doubled revenue.", "The result?"],
		["We need to circle back on pricing.", "circle back"],
		["- 🚀 Ship fast", "🚀 Ship fast"],
	])("flags %j", (doc, expected) => {
		expect(flaggedText("LinkedIn voice", doc)).toContain(expected);
	});

	it("flags a run of four one-sentence paragraphs once, for the whole note", () => {
		const doc = ["I got fired.", "It hurt.", "Then I started over.", "Best thing that ever happened."].join("\n\n");
		const runHits = hitsWithLabel("LinkedIn voice", doc).filter((hit) => hit.ruleId === "linkedin-voice.one-liners");
		expect(runHits).toEqual([expect.objectContaining({ scope: "document" })]);
	});

	it("flags a note where most paragraphs are one sentence, once, for the whole note", () => {
		const line = "This line is one sentence and it goes on for a while to make the note long enough.";
		const doc = Array.from({ length: 8 }, () => line).join("\n\n");
		const noteHits = hitsWithLabel("LinkedIn voice", doc).filter((hit) => hit.ruleId === "linkedin-voice.short-paragraphs");
		expect(noteHits).toEqual([expect.objectContaining({ from: 0, to: doc.length, ruleId: "linkedin-voice.short-paragraphs" })]);
	});

	it.each([
		"Do you agree with the plan?",
		"What do you think about the plan?",
		"I learned a lot from that project.",
		"The result was a smaller release.",
		"Here's how the parser works.",
		"Thoughts are cheap; drafts are not.",
	])("leaves %j alone", (doc) => {
		expect(hitsWithLabel("LinkedIn voice", doc)).toEqual([]);
	});
});

describe("Repetition", () => {
	it("flags a doubled word", () => {
		expect(flaggedText("Repetition", "The the cat sat.")).toEqual(["The the"]);
	});

	it("flags a content word used three times in a short stretch", () => {
		expect(flaggedText("Repetition", "The model trained the model so the model could learn.")).toHaveLength(1);
	});

	it("flags three sentences in a row that start with the same word", () => {
		const doc = "I wrote the draft. I cut it in half. I sent it to Sam.";
		expect(flaggedText("Repetition", doc)).toEqual(["I wrote the draft.", "I cut it in half.", "I sent it to Sam."]);
	});

	it.each([
		"I said that that was fine.",
		"We had had enough.",
		"I wrote the draft. Then I cut it. I sent it to Sam.",
		"They argue about what to build first, and how much of it to build before anyone sees it.",
		"- Use short words\n- Use active verbs\n- Use plain titles",
	])("leaves %j alone", (doc) => {
		expect(hitsWithLabel("Repetition", doc)).toEqual([]);
	});
});

describe("Awkward", () => {
	it("is judgment only: no local hits, one question per sentence", () => {
		const doc = "The thing that the team that the manager hired built broke. It was fixed.";
		expect(hitsWithLabel("Awkward", doc)).toEqual([]);
		const tasks = judgmentTasks(BUILTIN_RULES, doc).filter((task) => task.rule.id === "awkward");
		expect(tasks).toHaveLength(2);
		expect(tasks[0]).toMatchObject({ threshold: 0.7, question: expect.stringMatching(/\?$/) });
		expect(tasks[0]?.paragraph.text).toBe(doc);
	});
});

describe("Passive voice", () => {
	it.each([
		["The report was written by the intern.", "was written by"],
		["Mistakes were made by the team.", "were made by"],
		["The decision was quickly approved by the board.", "was quickly approved by"],
	])("flags %j", (doc, expected) => {
		expect(flaggedText("Passive voice", doc)).toEqual([expected]);
	});

	it.each([
		"The intern wrote the report.",
		"I was tired by noon.",
		"This is indeed true.",
		"The feature is enabled by default.",
		"She was interested in the job.",
		"Mistakes were made.",
	])("leaves %j alone", (doc) => {
		expect(hitsWithLabel("Passive voice", doc)).toEqual([]);
	});
});

describe("Adverbs", () => {
	it("flags a sentence crowded with -ly adverbs and names them", () => {
		const [hit] = hitsWithLabel("Adverbs", "She quickly and quietly closed the door and slowly walked away from the house.");
		expect(hit?.message).toBe("Adverb-heavy (quickly, quietly, slowly).");
	});

	it.each([
		"She closed the door quietly and walked home in the rain.",
		"The family met early each week to reply to every letter we got.",
		"Emily and Kelly flew to Italy in July with their friendly neighbors.",
	])("leaves %j alone", (doc) => {
		expect(hitsWithLabel("Adverbs", doc)).toEqual([]);
	});
});

describe("matching words", () => {
	it("respects word boundaries", () => {
		expect(textsOf(wordlist(["use"]), "The user can reuse or re-use the tool. Use it.")).toEqual(["Use"]);
	});

	it("treats curly and straight apostrophes as the same", () => {
		expect(textsOf(wordlist(["it's important to note"]), "It’s important to note this.")).toEqual(["It’s important to note"]);
		expect(textsOf(wordlist(["don’t"]), "Please don't.")).toEqual(["don't"]);
	});

	it("matches a phrase broken across lines and a hyphen written as a space", () => {
		const doc = "We did it in order\nto win. What a game changer.";
		expect(textsOf(wordlist(["in order to", "game-changer"]), doc)).toEqual(["in order\nto", "game changer"]);
	});

	it("ignores case unless told not to", () => {
		expect(textsOf(wordlist(["go"]), "Go home. go now.")).toEqual(["Go", "go"]);
		expect(textsOf(wordlist(["Go"], { ignorecase: false } as Partial<Rule>), "Go home. go now.")).toEqual(["Go"]);
	});

	it("puts the matched text into the message", () => {
		const [hit] = runLocalRules([wordlist(["synergy"], { message: "Corporate speak: '%s'" })], "Pure Synergy.");
		expect(hit?.message).toBe("Corporate speak: 'Synergy'");
	});

	it("never looks inside code, frontmatter or link targets", () => {
		const doc = "---\ntitle: I think\n---\nUse `I think` as a [placeholder](https://example.com/i-think).\n\n```\nI think\n```";
		expect(runLocalRules([wordlist(["I think"])], doc)).toEqual([]);
	});

	it("reads ^ as the start of each sentence in sentence rules", () => {
		const rule: Rule = { id: "test.so", label: "Test", scope: "sentence", engine: "regex", severity: "warning", patterns: ["^so\\b"] };
		expect(textsOf(rule, "We left. So it goes.")).toEqual(["So"]);
	});
});

describe("rule scopes", () => {
	const doc = "Synergy is here. More synergy.\n\nA calm paragraph.\n\nSynergy again.";

	it("paragraph rules mark each paragraph with a hit once", () => {
		const hits = runLocalRules([wordlist(["synergy"], { scope: "paragraph" })], doc);
		expect(hits.map((hit) => doc.slice(hit.from, hit.to))).toEqual(["Synergy is here. More synergy.", "Synergy again."]);
	});

	it("document rules give one hit covering the whole note", () => {
		const hits = runLocalRules([wordlist(["synergy"], { scope: "document" })], doc);
		expect(hits).toEqual([expect.objectContaining({ from: 0, to: doc.length, scope: "document", message: "Test: 'Synergy'" })]);
	});

	it("judgment tasks for a document rule cover the whole note once", () => {
		const rule: Rule = { id: "my.post", label: "Post", scope: "document", engine: "classifier", severity: "warning", question: "Is this a post?", threshold: 0.6 };
		expect(judgmentTasks([rule], doc)).toEqual([
			expect.objectContaining({ question: "Is this a post?", threshold: 0.6, unit: { from: 0, to: doc.length, text: doc } }),
		]);
	});

	it("judgment tasks skip headings and give LLM rules no threshold", () => {
		const rule: Rule = { id: "my.llm", label: "Tone", scope: "paragraph", engine: "llm", severity: "warning", prompt: "Quote cold phrases." };
		const tasks = judgmentTasks([rule], "# Title\n\nBody text.");
		expect(tasks).toEqual([expect.objectContaining({ question: "Quote cold phrases.", threshold: null, unit: expect.objectContaining({ text: "Body text." }) })]);
	});

	it("local runs skip classifier and LLM rules", () => {
		const rule: Rule = { id: "my.cold", label: "Cold", scope: "sentence", engine: "classifier", severity: "warning", question: "Is it cold?", threshold: 0.5 };
		expect(runLocalRules([rule], "Brr.")).toEqual([]);
	});
});

describe("metric rules", () => {
	it("skip units shorter than minWords", () => {
		const rule: Rule = { id: "t.len", label: "Len", scope: "sentence", engine: "metric", severity: "warning", metric: "sentence-words", max: 2, minWords: 5 };
		expect(textsOf(rule, "Too short here. This one has six words in it.")).toEqual(["This one has six words in it."]);
	});

	it("measure a paragraph as a whole when the rule is paragraph scope", () => {
		const rule: Rule = { id: "t.len", label: "Len", scope: "paragraph", engine: "metric", severity: "warning", metric: "sentence-words", max: 4 };
		const doc = "One two three. Four five six.\n\nA much longer sentence sits in this one.";
		expect(textsOf(rule, doc)).toEqual(["A much longer sentence sits in this one."]);
	});
});

describe("parsing rule files", () => {
	it("reads the wordlist example from the docs", () => {
		const result = parseRule(`
id: my.corporate
label: Corporate speak
scope: sentence
engine: wordlist
tokens: [synergy, circle back, move the needle, low-hanging fruit]
ignorecase: true
message: "Corporate speak: '%s'"
severity: warning
`);
		expect(result).toEqual({
			ok: true,
			rule: {
				id: "my.corporate",
				label: "Corporate speak",
				scope: "sentence",
				engine: "wordlist",
				severity: "warning",
				tokens: ["synergy", "circle back", "move the needle", "low-hanging fruit"],
				ignorecase: true,
				message: "Corporate speak: '%s'",
			},
		});
	});

	it("fills in defaults for severity, ignorecase, label and scope", () => {
		const result = parseRule("id: my.words\nengine: wordlist\ntokens: [foo]");
		expect(result.ok && result.rule).toMatchObject({ label: "my.words", scope: "sentence", severity: "warning", ignorecase: true });
	});

	it("reads a classifier rule", () => {
		const result = parseRule(`id: my.cold\nlabel: Too cold\nscope: paragraph\nengine: classifier\nquestion: "Does this paragraph read as emotionally cold or detached?"\nthreshold: 0.65`);
		expect(result.ok && result.rule).toMatchObject({ engine: "classifier", threshold: 0.65, scope: "paragraph" });
	});

	it.each([
		[
			"id: my.cold\nengine: classifier\nquestion: Cold?\nthreshold: 2",
			"Rule 'my.cold': 'threshold' must be a number between 0 and 1",
		],
		["engine: wordlist\ntokens: [a]", "Rule: 'id' is required, for example 'id: my.corporate'"],
		["id: x\nengine: magic", "Rule 'x': 'engine' must be one of: wordlist, regex, substitution, metric, classifier, llm"],
		["id: x\nengine: wordlist\ntoken: [a]", "Rule 'x': unknown field 'token'."],
		["id: x\nengine: wordlist\ntokens: []", "Rule 'x': 'tokens' must be a list of words or phrases"],
		["id: x\nengine: regex\npatterns: ['(unclosed']", "Rule 'x': pattern '(unclosed' is not a valid regular expression"],
		['id: x\nengine: regex\npatterns: ["\\bso\\b"]', "Write patterns in single quotes"],
		["id: x\nengine: metric\nmetric: one-sentence-paragraph-ratio\nmax: 0.5", "Rule 'x': metric 'one-sentence-paragraph-ratio' works with scope document, not 'sentence'"],
		["id: x\nengine: metric\nmetric: sentence-words", "Rule 'x': 'max' must be a number of 0 or more"],
		["id: x\nengine: substitution\nswap: [a, b]", "Rule 'x': 'swap' must map each wordy phrase to its replacement"],
		["id: x\nengine: classifier\nquestion: Q?\nthreshold: 0.5\njudgment: {question: Q?, threshold: 0.5}", "'judgment' only goes on wordlist, regex, substitution and metric rules"],
		["id: x\nengine: wordlist\ntokens: [a]\njudgment: {question: Q?, threshold: high}", "Rule 'x': in 'judgment', 'threshold' must be a number between 0 and 1"],
		["id: x\nengine: wordlist\ntokens: [a\n", "This rule file is not valid YAML"],
		["- just\n- a list", "A rule file must be a list of 'field: value' lines"],
	])("explains what is wrong with %j", (yamlText, expectedError) => {
		const result = parseRule(yamlText);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join("\n")).toContain(expectedError);
	});

	it("reports every problem at once", () => {
		const result = parseRule("id: x\nengine: classifier\nseverity: loud\nthreshold: -1");
		expect(result.ok ? [] : result.errors).toHaveLength(3);
	});

	it("round-trips every built-in rule through YAML", () => {
		for (const rule of BUILTIN_RULES) {
			const { origin: _origin, ...withoutOrigin } = rule;
			expect(parseRule(serializeRule(rule))).toEqual({ ok: true, rule: withoutOrigin });
		}
	});

	it("ships one YAML file per built-in rule, named by id", () => {
		expect(BUILTIN_RULE_FILES.map((file) => file.fileName)).toEqual(BUILTIN_RULES.map((rule) => `${rule.id}.yaml`));
		expect(BUILTIN_RULE_FILES[0]?.yaml).toMatch(/^id: hedging\nlabel: Hedging\n/);
	});
});
