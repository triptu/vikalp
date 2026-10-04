import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { LintScope, Severity } from "../model/types";
import { compileRulePattern } from "./phrases";
import type { JudgmentCheck, MetricName, Rule, RuleEngineName, RuleParseResult } from "./types";

const SCOPES: LintScope[] = ["sentence", "paragraph", "document"];
const SEVERITIES: Severity[] = ["suggestion", "warning", "error"];
const ENGINES: RuleEngineName[] = ["wordlist", "regex", "substitution", "metric", "classifier", "llm"];

/** Which scopes each metric can measure. */
export const METRIC_SCOPES: Record<MetricName, LintScope[]> = {
	"sentence-words": ["sentence", "paragraph", "document"],
	"readability-grade": ["sentence", "paragraph", "document"],
	"long-word-ratio": ["sentence", "paragraph", "document"],
	"adverb-density": ["sentence", "paragraph", "document"],
	"em-dash-density": ["sentence", "paragraph", "document"],
	"paragraph-words": ["paragraph", "document"],
	"repeated-word": ["sentence", "paragraph", "document"],
	"repeated-opener": ["sentence", "paragraph", "document"],
	"one-sentence-paragraph-run": ["paragraph", "document"],
	"one-sentence-paragraph-ratio": ["document"],
};

const COMMON_FIELDS = ["id", "label", "description", "scope", "engine", "severity", "message", "judgment"];

const ENGINE_FIELDS: Record<RuleEngineName, string[]> = {
	wordlist: ["tokens", "ignorecase"],
	regex: ["patterns", "ignorecase"],
	substitution: ["swap", "ignorecase"],
	metric: ["metric", "max", "minWords"],
	classifier: ["question", "threshold"],
	llm: ["prompt"],
};

/** Control characters other than tab and newline. In a YAML double-quoted string, "\b" turns into one of these. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

type Fields = Record<string, unknown>;

/**
 * Reads one rule from YAML and checks it. Errors are full sentences meant for
 * the user, e.g. "Rule 'my.cold': 'threshold' must be a number between 0 and 1".
 * Missing `severity` becomes "warning", missing `ignorecase` becomes true,
 * missing `label` becomes the id and missing `scope` becomes "sentence".
 */
export function parseRule(yamlText: string): RuleParseResult {
	let parsed: unknown;
	try {
		parsed = parseYaml(yamlText);
	} catch (error) {
		return { ok: false, errors: [`This rule file is not valid YAML: ${errorText(error)}`] };
	}
	if (!isFields(parsed)) return { ok: false, errors: ["A rule file must be a list of 'field: value' lines, starting with 'id:'."] };
	return validateRule(parsed);
}

function validateRule(fields: Fields): RuleParseResult {
	const errors: string[] = [];
	const rawId = fields.id;
	const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
	const report = (problem: string) => errors.push(`${id ? `Rule '${id}'` : "Rule"}: ${problem}`);
	const read = new FieldReader(fields, report);

	if (!id) report("'id' is required, for example 'id: my.corporate'");
	else if (/\s/.test(id)) report("'id' cannot contain spaces");

	const label = read.optionalText("label") ?? id;
	const description = read.optionalText("description");
	const message = read.optionalText("message");
	const scope = read.choice("scope", SCOPES, "sentence");
	const severity = read.choice("severity", SEVERITIES, "warning");
	const engine = read.choice("engine", ENGINES, undefined);

	if (!engine) return { ok: false, errors };

	const allowedFields = [...COMMON_FIELDS, ...ENGINE_FIELDS[engine]];
	for (const field of Object.keys(fields)) {
		if (!allowedFields.includes(field)) report(`unknown field '${field}'. A ${engine} rule can have: ${allowedFields.join(", ")}`);
	}

	const isLocal = engine !== "classifier" && engine !== "llm";
	const judgment = fields.judgment === undefined ? undefined : readJudgment(fields.judgment, isLocal, report);

	const base = {
		id,
		label,
		scope: scope ?? "sentence",
		severity: severity ?? "warning",
		...(description !== undefined ? { description } : {}),
		...(message !== undefined ? { message } : {}),
		...(judgment ? { judgment } : {}),
	};

	let rule: Rule | null = null;
	switch (engine) {
		case "wordlist": {
			const tokens = read.textList("tokens", "'tokens' must be a list of words or phrases, for example 'tokens: [synergy, circle back]'");
			const ignorecase = read.flag("ignorecase", true);
			if (tokens) rule = { ...base, engine, tokens, ignorecase };
			break;
		}
		case "regex": {
			const patterns = read.textList("patterns", "'patterns' must be a list of regular expressions");
			const ignorecase = read.flag("ignorecase", true);
			for (const pattern of patterns ?? []) checkPattern(pattern, ignorecase, report);
			if (patterns) rule = { ...base, engine, patterns, ignorecase };
			break;
		}
		case "substitution": {
			const swap = read.swap("swap");
			const ignorecase = read.flag("ignorecase", true);
			if (swap) rule = { ...base, engine, swap, ignorecase };
			break;
		}
		case "metric": {
			const metric = read.choice("metric", Object.keys(METRIC_SCOPES) as MetricName[], undefined);
			const max = read.number("max", { min: 0 }, "'max' must be a number of 0 or more");
			const minWords = read.optionalNumber("minWords", { min: 0, integer: true }, "'minWords' must be a whole number of 0 or more");
			if (metric && scope && !METRIC_SCOPES[metric].includes(scope)) {
				report(`metric '${metric}' works with scope ${METRIC_SCOPES[metric].join(" or ")}, not '${scope}'`);
			}
			if (metric && max !== undefined) rule = { ...base, engine, metric, max, ...(minWords !== undefined ? { minWords } : {}) };
			break;
		}
		case "classifier": {
			const question = read.requiredText("question", "'question' is required: a yes/no question about the text, ending in '?'");
			const threshold = read.number("threshold", { min: 0, max: 1 }, "'threshold' must be a number between 0 and 1");
			if (question !== undefined && threshold !== undefined) rule = { ...base, engine, question, threshold };
			break;
		}
		case "llm": {
			const prompt = read.requiredText("prompt", "'prompt' is required: instructions for the model");
			if (prompt !== undefined) rule = { ...base, engine, prompt };
			break;
		}
	}

	if (errors.length > 0 || !rule) return { ok: false, errors };
	return { ok: true, rule };
}

function readJudgment(value: unknown, isLocal: boolean, report: (problem: string) => void): JudgmentCheck | undefined {
	if (!isLocal) {
		report("'judgment' only goes on wordlist, regex, substitution and metric rules. Classifier and LLM rules already ask their own question");
		return undefined;
	}
	if (!isFields(value)) {
		report("'judgment' must have a 'question' and a 'threshold'");
		return undefined;
	}
	const read = new FieldReader(value, (problem) => report(`in 'judgment', ${problem}`));
	for (const field of Object.keys(value)) {
		if (!["question", "threshold", "message"].includes(field)) report(`unknown field '${field}' in 'judgment'. It can have: question, threshold, message`);
	}
	const question = read.requiredText("question", "'question' is required: a yes/no question about the text");
	const threshold = read.number("threshold", { min: 0, max: 1 }, "'threshold' must be a number between 0 and 1");
	const message = read.optionalText("message");
	if (question === undefined || threshold === undefined) return undefined;
	return { question, threshold, ...(message !== undefined ? { message } : {}) };
}

function checkPattern(pattern: string, ignorecase: boolean, report: (problem: string) => void): void {
	if (CONTROL_CHARACTER.test(pattern)) {
		report(`pattern '${pattern}' contains a control character. Write patterns in single quotes so backslashes like \\b stay as written`);
		return;
	}
	try {
		compileRulePattern(pattern, ignorecase);
	} catch (error) {
		report(`pattern '${pattern}' is not a valid regular expression (${errorText(error)})`);
	}
}

/** Reads typed fields from a parsed YAML mapping and reports problems in plain words. */
class FieldReader {
	private readonly fields: Fields;
	private readonly report: (problem: string) => void;

	constructor(fields: Fields, report: (problem: string) => void) {
		this.fields = fields;
		this.report = report;
	}

	optionalText(name: string): string | undefined {
		const value = this.fields[name];
		if (value === undefined || value === null) return undefined;
		if (typeof value === "string") return value;
		if (typeof value === "number") return String(value);
		this.report(`'${name}' must be text`);
		return undefined;
	}

	requiredText(name: string, problem: string): string | undefined {
		const value = this.optionalText(name)?.trim();
		if (!value) {
			this.report(problem);
			return undefined;
		}
		return value;
	}

	choice<Option extends string>(name: string, options: Option[], fallback: Option | undefined): Option | undefined {
		const value = this.fields[name];
		if (value === undefined || value === null) {
			if (fallback === undefined) this.report(`'${name}' is required. Use one of: ${options.join(", ")}`);
			return fallback;
		}
		if (typeof value === "string" && (options as string[]).includes(value)) return value as Option;
		this.report(`'${name}' must be one of: ${options.join(", ")}`);
		return undefined;
	}

	flag(name: string, fallback: boolean): boolean {
		const value = this.fields[name];
		if (value === undefined || value === null) return fallback;
		if (typeof value === "boolean") return value;
		this.report(`'${name}' must be true or false`);
		return fallback;
	}

	number(name: string, limits: { min?: number; max?: number; integer?: boolean }, problem: string): number | undefined {
		const value = this.fields[name];
		const valid =
			typeof value === "number" &&
			Number.isFinite(value) &&
			(limits.min === undefined || value >= limits.min) &&
			(limits.max === undefined || value <= limits.max) &&
			(!limits.integer || Number.isInteger(value));
		if (!valid) {
			this.report(problem);
			return undefined;
		}
		return value;
	}

	optionalNumber(name: string, limits: { min?: number; max?: number; integer?: boolean }, problem: string): number | undefined {
		if (this.fields[name] === undefined || this.fields[name] === null) return undefined;
		return this.number(name, limits, problem);
	}

	textList(name: string, problem: string): string[] | undefined {
		const value = this.fields[name];
		const entries = Array.isArray(value) ? value : null;
		const texts = entries?.map((entry) => (typeof entry === "string" || typeof entry === "number" ? String(entry) : null));
		if (!texts || texts.length === 0 || texts.some((text) => text === null || text.trim() === "")) {
			this.report(problem);
			return undefined;
		}
		return texts as string[];
	}

	swap(name: string): Record<string, string> | undefined {
		const value = this.fields[name];
		if (!isFields(value) || Object.keys(value).length === 0) {
			this.report(`'${name}' must map each wordy phrase to its replacement, for example 'in order to: to'`);
			return undefined;
		}
		const swap: Record<string, string> = {};
		for (const [phrase, replacement] of Object.entries(value)) {
			if (replacement === null) swap[phrase] = "";
			else if (typeof replacement === "string" || typeof replacement === "number") swap[phrase] = String(replacement);
			else this.report(`the replacement for '${phrase}' in '${name}' must be text`);
		}
		return swap;
	}
}

function isFields(value: unknown): value is Fields {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message.split("\n")[0] ?? error.message : String(error);
}

/**
 * Writes a rule as YAML in the same shape `parseRule` reads, with fields in a
 * fixed, readable order. Used to put the built-in rules in the rules folder and
 * for "New rule from selection".
 */
export function serializeRule(rule: Rule): string {
	const fields: Fields = { id: rule.id, label: rule.label };
	if (rule.description) fields.description = rule.description;
	fields.scope = rule.scope;
	fields.engine = rule.engine;
	fields.severity = rule.severity;
	switch (rule.engine) {
		case "wordlist":
			fields.tokens = rule.tokens;
			fields.ignorecase = rule.ignorecase ?? true;
			break;
		case "regex":
			fields.patterns = rule.patterns;
			fields.ignorecase = rule.ignorecase ?? true;
			break;
		case "substitution":
			fields.swap = rule.swap;
			fields.ignorecase = rule.ignorecase ?? true;
			break;
		case "metric":
			fields.metric = rule.metric;
			fields.max = rule.max;
			if (rule.minWords !== undefined) fields.minWords = rule.minWords;
			break;
		case "classifier":
			fields.question = rule.question;
			fields.threshold = rule.threshold;
			break;
		case "llm":
			fields.prompt = rule.prompt;
			break;
	}
	if (rule.message) fields.message = rule.message;
	if (rule.judgment) {
		fields.judgment = {
			question: rule.judgment.question,
			threshold: rule.judgment.threshold,
			...(rule.judgment.message ? { message: rule.judgment.message } : {}),
		};
	}
	return stringifyYaml(fields, { lineWidth: 0 });
}
