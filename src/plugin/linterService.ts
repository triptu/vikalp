import { EditorSelection } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { Notice, type App } from "obsidian";
import { AiError, type AiClient } from "../ai/aiClient";
import { makeAnchor, resolveAnchor } from "../core/anchor/anchor";
import { placeQuotes } from "../core/ai/placement";
import { JUDGMENT_SYSTEM, JUDGMENT_TOOL, LLM_RULE_TOOL, judgmentPrompt, judgmentSchema, llmRulePrompt, llmRuleSchema, type JudgmentOutput, type LlmRuleOutput } from "../core/ai/prompts/judgment";
import { numberSentences, renderNumbered } from "../core/ai/units";
import { newId } from "../core/model/ids";
import type { ModelMode, VikalpSettings } from "../core/settings";
import { BUILTIN_RULES, BUILTIN_RULE_FILES } from "../core/rules/builtin";
import { parseRule, serializeRule } from "../core/rules/parse";
import { judgmentTasks, runLocalRules, type JudgmentTask } from "../core/rules/run";
import type { Rule, WordlistRule } from "../core/rules/types";
import { countWords, segmentNote } from "../core/text/segment";
import { lintMarks, type LintMarkMeta } from "../editor/collections";
import { notePathOf } from "../editor/noteFields";
import { VIKALP_EVENT, isolated, noHistory } from "../editor/transactions";
import type { RangeEntry } from "../editor/rangeCollection";
import type { UiStore } from "../store/uiStore";
import { confirmAction, promptText } from "./modals";
import type { NoteController } from "./noteController";

const JEV_CONCURRENCY = 6;
const LLM_JUDGMENT_BATCH = 40;
const LIVE_LINT_DELAY_MS = 900;
/** Remembers the built-in rule files as written, to tell untouched ones from edited ones. */
const BUILTIN_RECORD = ".builtin-rules.json";

/**
 * Runs the writing linter on demand: free local rules instantly, then
 * judgment rules through Jev (or an LLM), filling in marks as answers arrive.
 */
export class LinterService {
	private rules: Rule[] = BUILTIN_RULES;
	/** Where each rule was read from, so edits go back to the same file. */
	private readonly ruleFiles = new Map<string, string>();
	private readonly editedBuiltins = new Set<string>();
	private ruleErrors: string[] = [];
	private readonly ignored = new Map<string, Set<string>>();
	private liveTimer: number | null = null;
	private runToken = 0;

	constructor(
		private readonly app: App,
		private readonly client: AiClient,
		private readonly controller: NoteController,
		private readonly store: UiStore,
		private readonly getSettings: () => VikalpSettings,
		private readonly pluginDir: string,
		private readonly openPanel: () => void,
	) {}

	private get rulesDir() {
		return `${this.pluginDir}/${this.getSettings().rulesFolder}`;
	}

	allRules(): Rule[] {
		return this.rules;
	}

	private enabledRules(): Rule[] {
		const disabled = new Set(this.getSettings().disabledRules);
		return this.rules.filter((rule) => !disabled.has(rule.id));
	}

	/**
	 * Reads rule files. Built-ins are written to the folder so they can be
	 * edited; a built-in file the user never changed is refreshed when Vikalp
	 * ships a better version of that rule.
	 */
	async loadRules() {
		const adapter = this.app.vault.adapter;
		const dir = this.rulesDir;
		const errors: string[] = [];
		try {
			await this.syncBuiltinFiles(dir);
			const { files } = await adapter.list(dir);
			const fromDisk = new Map<string, Rule>();
			this.ruleFiles.clear();
			this.editedBuiltins.clear();
			for (const file of files.filter((name) => /\.ya?ml$/i.test(name))) {
				const text = await adapter.read(file);
				const result = parseRule(text);
				const fileName = file.replace(/^.*\//, "");
				if (result.ok) {
					const shipped = BUILTIN_RULE_FILES.find((builtinFile) => builtinFile.fileName === `${result.rule.id}.yaml`);
					fromDisk.set(result.rule.id, { ...result.rule, origin: shipped ? "builtin" : "user" });
					this.ruleFiles.set(result.rule.id, file);
					if (shipped && shipped.yaml !== text) this.editedBuiltins.add(result.rule.id);
				} else errors.push(...result.errors.map((error) => `${fileName}: ${error}`));
			}
			const merged = BUILTIN_RULES.map((rule) => fromDisk.get(rule.id) ?? rule);
			for (const rule of fromDisk.values()) if (!BUILTIN_RULES.some((builtin) => builtin.id === rule.id)) merged.push(rule);
			this.rules = merged;
		} catch (error) {
			errors.push(`Could not read the rules folder: ${String(error)}`);
			this.rules = BUILTIN_RULES;
		}
		this.ruleErrors = errors;
		this.patchRun({ ruleErrors: errors });
	}

	private async syncBuiltinFiles(dir: string) {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
		const recordPath = `${dir}/${BUILTIN_RECORD}`;
		const written: Record<string, string> = (await adapter.exists(recordPath)) ? JSON.parse(await adapter.read(recordPath)) : {};
		for (const file of BUILTIN_RULE_FILES) {
			const path = `${dir}/${file.fileName}`;
			const exists = await adapter.exists(path);
			const onDisk = exists ? await adapter.read(path) : null;
			if (onDisk === file.yaml) {
				written[file.fileName] = file.yaml;
				continue;
			}
			const untouched = onDisk !== null && onDisk === written[file.fileName];
			if ((onDisk === null && written[file.fileName] === undefined) || untouched) {
				await adapter.write(path, file.yaml);
				written[file.fileName] = file.yaml;
			}
		}
		await adapter.write(recordPath, JSON.stringify(written, null, "\t"));
	}

	/** True for a built-in rule whose file the user has changed. */
	isEdited(ruleId: string): boolean {
		return this.editedBuiltins.has(ruleId);
	}

	/** Writes a rule to its file (a new one for new rules) and reloads every rule. */
	async saveRule(rule: Rule) {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.rulesDir))) await adapter.mkdir(this.rulesDir);
		const path = this.ruleFiles.get(rule.id) ?? `${this.rulesDir}/${rule.id}.yaml`;
		await adapter.write(path, serializeRule(rule));
		await this.loadRules();
		this.relintIfMarked();
	}

	/** Puts a built-in rule back the way Vikalp ships it. */
	async resetRule(ruleId: string) {
		const shipped = BUILTIN_RULE_FILES.find((file) => file.fileName === `${ruleId}.yaml`);
		if (!shipped) return;
		const adapter = this.app.vault.adapter;
		await adapter.write(this.ruleFiles.get(ruleId) ?? `${this.rulesDir}/${shipped.fileName}`, shipped.yaml);
		await this.loadRules();
		this.relintIfMarked();
	}

	/** Deletes a rule you added. Built-in rules can only be switched off. */
	async deleteRule(ruleId: string) {
		const path = this.ruleFiles.get(ruleId);
		const rule = this.rules.find((candidate) => candidate.id === ruleId);
		if (!path || rule?.origin !== "user") return;
		await this.app.vault.adapter.remove(path);
		await this.loadRules();
		this.relintIfMarked();
	}

	/** How many marks a rule makes on the open note, for the editor's preview. Local rules only. */
	previewHits(rule: Rule): { count: number; examples: string[] } | null {
		const view = this.controller.editor;
		if (!view || rule.engine === "classifier" || rule.engine === "llm") return null;
		const doc = view.state.doc.toString();
		const hits = runLocalRules([rule], doc);
		return { count: hits.length, examples: hits.slice(0, 3).map((hit) => doc.slice(hit.from, hit.to).replace(/\s+/g, " ").slice(0, 80)) };
	}

	private relintIfMarked() {
		const view = this.controller.editor;
		if (view && lintMarks.list(view.state).some((entry) => entry.meta.source === "rule")) this.runLocal(view);
	}

	async reloadRules() {
		await this.loadRules();
		new Notice(this.ruleErrors.length ? `Rules reloaded with ${this.ruleErrors.length} problem(s). See the Lint panel.` : `Loaded ${this.rules.length} rules.`);
		if (this.controller.editor && lintMarks.list(this.controller.editor.state).some((entry) => entry.meta.source === "rule")) this.runLocal(this.controller.editor);
	}

	openRulesFolder() {
		const basePath = (this.app.vault.adapter as unknown as { getBasePath?: () => string }).getBasePath?.();
		const electron = (window as unknown as { require?: (name: string) => { shell?: { openPath(path: string): Promise<string> } } }).require?.("electron");
		if (basePath && electron?.shell) void electron.shell.openPath(`${basePath}/${this.rulesDir}`);
		else new Notice(`Rules live in ${this.rulesDir}`);
	}

	private patchRun(patch: Partial<ReturnType<UiStore["getState"]>["lint"]>) {
		this.store.setState({ lint: { ...this.store.getState().lint, ...patch } });
	}

	private ignoredFor(path: string): Set<string> {
		let set = this.ignored.get(path);
		if (!set) {
			set = new Set();
			this.ignored.set(path, set);
		}
		return set;
	}

	/** Replaces local rule marks with a fresh run. Judgment marks and Lab marks stay. */
	private runLocal(view: EditorView): number {
		const path = this.controller.activePath ?? "";
		const doc = view.state.doc.toString();
		const ignored = this.ignoredFor(path);
		const drafts = runLocalRules(this.enabledRules(), doc).filter((draft) => !ignored.has(ignoreKey(draft.ruleId, doc.slice(draft.from, draft.to))));
		const entries: RangeEntry<LintMarkMeta>[] = drafts.map((draft) => ({
			range: { from: draft.from, to: draft.to },
			meta: {
				id: newId("ln"),
				ruleId: draft.ruleId,
				label: draft.label,
				message: draft.message,
				severity: draft.severity,
				scope: draft.scope,
				source: "rule",
				...(draft.suggestion !== undefined ? { suggestion: draft.suggestion } : {}),
			},
		}));
		const stale = lintMarks.list(view.state).filter((entry) => entry.meta.source === "rule" && !entry.meta.judgment);
		view.dispatch({ effects: [lintMarks.effects.remove.of(stale.map((entry) => entry.meta.id)), lintMarks.effects.add.of(entries)], annotations: noHistory });
		return entries.length;
	}

	async run() {
		const view = this.controller.editor;
		const path = this.controller.activePath;
		if (!view || !path) {
			new Notice("Open a note first.");
			return;
		}
		this.openPanel();
		const token = ++this.runToken;
		const judgmentMarks = lintMarks.list(view.state).filter((entry) => entry.meta.judgment);
		if (judgmentMarks.length) view.dispatch({ effects: lintMarks.effects.remove.of(judgmentMarks.map((entry) => entry.meta.id)), annotations: noHistory });
		this.runLocal(view);

		const doc = view.state.doc.toString();
		const tasks = judgmentTasks(this.enabledRules(), doc).filter((task) => task.unit.text.trim().split(/\s+/).length >= 4 || task.rule.scope !== "sentence");
		const canJudge = this.client.hasKey && tasks.length > 0;
		this.patchRun({
			running: canJudge,
			ranAt: Date.now(),
			judgmentTotal: canJudge ? tasks.length : 0,
			judgmentDone: 0,
			notice: !this.client.hasKey && tasks.length > 0 ? "Local rules only. Add an OpenRouter key in settings to run judgment rules too." : null,
			ruleErrors: this.ruleErrors,
			notePath: path,
			cost: 0,
		});
		if (!canJudge) return;
		const costsBefore = this.store.getState().costs.length;
		try {
			await this.runJudgments(view, path, tasks, token, doc);
		} finally {
			const runCost = this.store.getState().costs.slice(costsBefore).reduce((sum, entry) => sum + entry.cost, 0);
			if (token === this.runToken) this.patchRun({ running: false, cost: runCost });
		}
	}

	private async runJudgments(view: EditorView, path: string, tasks: JudgmentTask[], token: number, runDoc: string) {
		const settings = this.getSettings();
		const classifierTasks = tasks.filter((task) => task.threshold !== null);
		const llmRuleTasks = tasks.filter((task) => task.threshold === null);
		const stillCurrent = () => token === this.runToken && this.controller.editor === view && notePathOf(view) === path;
		const done = (count: number) => {
			if (stillCurrent()) this.patchRun({ judgmentDone: this.store.getState().lint.judgmentDone + count });
		};

		const flaggedNoteRules: JudgmentTask[] = [];
		const flag = (task: JudgmentTask, probability: number, model: string) => {
			if (!stillCurrent() || probability < (task.threshold ?? 1)) return;
			this.addJudgmentHit(view, path, task, task.unit, task.message, model, runDoc);
			if (task.rule.scope === "document" && task.rule.engine === "classifier" && task.rule.paragraphQuestion) flaggedNoteRules.push(task);
		};

		let fallbackCount = 0;
		const judge = async (batch: JudgmentTask[]) => {
			if (settings.judgmentEngine === "jev") {
				const failed = await this.judgeWithJev(batch, flag, done, stillCurrent);
				if (failed.length && stillCurrent()) {
					fallbackCount += failed.length;
					await this.judgeWithLlm(failed, "lite", flag, done, stillCurrent, true);
				}
			} else {
				await this.judgeWithLlm(batch, settings.modelMode, flag, done, stillCurrent, false);
			}
		};
		await judge(classifierTasks);

		// A note-level verdict says nothing about where. Ask the same kind of question per paragraph.
		const paragraphTasks = flaggedNoteRules.flatMap((noteTask) => paragraphFollowUps(noteTask, runDoc));
		if (paragraphTasks.length && stillCurrent()) {
			this.patchRun({ judgmentTotal: this.store.getState().lint.judgmentTotal + paragraphTasks.length });
			await judge(paragraphTasks);
		}

		const llmRules = [...new Set(llmRuleTasks.map((task) => task.rule))];
		for (const rule of llmRules) {
			if (!stillCurrent()) return;
			await this.runLlmRule(view, path, rule, llmRuleTasks.filter((task) => task.rule === rule), stillCurrent);
			done(llmRuleTasks.filter((task) => task.rule === rule).length);
		}
		if (fallbackCount > 0 && stillCurrent()) {
			const notice = `Jev was unavailable, so the Lite model made ${fallbackCount} ${fallbackCount === 1 ? "judgment" : "judgments"}. The cost log marks them.`;
			this.patchRun({ notice });
			new Notice(notice, 6000);
		}
	}

	/** Asks Jev about each unit, all of its rules' questions at once. Returns the tasks it could not answer. */
	private async judgeWithJev(
		tasks: JudgmentTask[],
		flag: (task: JudgmentTask, probability: number, model: string) => void,
		done: (count: number) => void,
		stillCurrent: () => boolean,
	): Promise<JudgmentTask[]> {
		const byUnit = new Map<string, JudgmentTask[]>();
		for (const task of tasks) {
			const key = `${task.unit.from}:${task.unit.to}`;
			byUnit.set(key, [...(byUnit.get(key) ?? []), task]);
		}
		const groups = [...byUnit.values()];
		const failed: JudgmentTask[] = [];
		let jevDown = false;
		let cursor = 0;
		const worker = async () => {
			while (cursor < groups.length && stillCurrent()) {
				const group = groups[cursor++]!;
				if (jevDown) {
					failed.push(...group);
					continue;
				}
				const first = group[0]!;
				const state = first.rule.scope === "document" ? { note: first.unit.text } : { text: first.unit.text, paragraph: first.paragraph.text };
				const questions = Object.fromEntries(
					group.map((task, index) => [
						`q${index}`,
						{ type: "bool" as const, instructions: task.question, criteria: { true: "Yes", false: "No" } },
					]),
				);
				try {
					const { answers, model } = await this.client.classify("Lint judgments (Jev)", state, questions);
					group.forEach((task, index) => flag(task, answers[`q${index}`] ?? 0, model));
					done(group.length);
				} catch (error) {
					console.warn("Vikalp: Jev call failed", error);
					jevDown = true;
					failed.push(...group);
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(JEV_CONCURRENCY, groups.length) }, worker));
		return failed;
	}

	private async judgeWithLlm(
		tasks: JudgmentTask[],
		mode: ModelMode,
		flag: (task: JudgmentTask, probability: number, model: string) => void,
		done: (count: number) => void,
		stillCurrent: () => boolean,
		isFallback: boolean,
	) {
		for (let start = 0; start < tasks.length; start += LLM_JUDGMENT_BATCH) {
			if (!stillCurrent()) return;
			const batch = tasks.slice(start, start + LLM_JUDGMENT_BATCH);
			const items = batch.map((task, index) => ({ id: `j${index + 1}`, question: task.question, text: task.unit.text, context: task.rule.scope === "document" ? "" : task.paragraph.text }));
			try {
				const { value, model } = await this.client.structured<JudgmentOutput>({
					purpose: isFallback ? "Lint judgments (Jev fallback)" : "Lint judgments",
					mode,
					system: JUDGMENT_SYSTEM,
					user: judgmentPrompt(items),
					toolName: JUDGMENT_TOOL,
					toolDescription: "Submit a probability for every item.",
					schema: judgmentSchema,
				});
				if (isFallback) this.markLastCostAsFallback();
				const byId = new Map((value.answers ?? []).map((answer) => [answer.id, Number(answer.probability)]));
				batch.forEach((task, index) => flag(task, byId.get(`j${index + 1}`) ?? 0, model));
			} catch (error) {
				if (stillCurrent()) this.patchRun({ notice: error instanceof AiError ? error.message : `Judgment rules failed: ${String(error)}` });
			}
			done(batch.length);
		}
	}

	private markLastCostAsFallback() {
		const costs = this.store.getState().costs;
		const last = costs[costs.length - 1];
		if (last) this.store.setState({ costs: [...costs.slice(0, -1), { ...last, fallback: true }] });
	}

	private async runLlmRule(view: EditorView, path: string, rule: Rule, tasks: JudgmentTask[], stillCurrent: () => boolean) {
		if (rule.engine !== "llm") return;
		const doc = view.state.doc.toString();
		const sentences = numberSentences(doc);
		try {
			const { value, model } = await this.client.structured<LlmRuleOutput>({
				purpose: `Lint · ${rule.label}`,
				mode: this.getSettings().modelMode,
				system: JUDGMENT_SYSTEM,
				user: llmRulePrompt(rule.prompt, renderNumbered(sentences)),
				toolName: LLM_RULE_TOOL,
				toolDescription: "Submit the hits.",
				schema: llmRuleSchema,
			});
			if (!stillCurrent()) return;
			const currentDoc = view.state.doc.toString();
			const { placed } = placeQuotes(currentDoc, sentences, (value.hits ?? []).map((hit) => ({ unit_id: hit.unit_id, quote: hit.quote, extra: hit.reason })));
			for (const quote of placed) this.addJudgmentHit(view, path, tasks[0]!, quote, quote.extra || tasks[0]!.message, model, null);
		} catch (error) {
			this.patchRun({ notice: error instanceof AiError ? error.message : `${rule.label} failed: ${String(error)}` });
		}
	}

	/**
	 * Adds one judgment mark. `runDoc` is the text the unit was measured on; the
	 * unit is found again in the current text, since the user may have typed
	 * while the model was thinking. Units that can't be found are dropped.
	 */
	private addJudgmentHit(
		view: EditorView,
		path: string,
		task: JudgmentTask,
		measured: { from: number; to: number },
		message: string,
		model: string,
		runDoc: string | null,
	) {
		const range = runDoc === null ? measured : resolveAnchor(view.state.doc.toString(), makeAnchor(runDoc, measured));
		if (!range || range.to > view.state.doc.length) return;
		const text = view.state.doc.sliceString(range.from, range.to);
		if (this.ignoredFor(path).has(ignoreKey(task.rule.id, text))) return;
		const duplicate = lintMarks.list(view.state).some((entry) => entry.meta.ruleId === task.rule.id && entry.range.from === range.from && entry.range.to === range.to);
		if (duplicate) return;
		const entry: RangeEntry<LintMarkMeta> = {
			range: { from: range.from, to: range.to },
			meta: {
				id: newId("ln"),
				ruleId: task.rule.id,
				label: task.rule.label,
				message,
				severity: task.rule.severity,
				scope: task.rule.scope,
				source: "rule",
				judgment: true,
				model,
			},
		};
		view.dispatch({ effects: lintMarks.effects.add.of([entry]), annotations: noHistory });
	}

	clear() {
		this.runToken++;
		const view = this.controller.editor;
		if (!view) return;
		view.dispatch({ effects: lintMarks.effects.replaceAll.of([]), annotations: noHistory });
		this.patchRun({ running: false, ranAt: null, judgmentTotal: 0, judgmentDone: 0, notice: null });
	}

	jumpTo(hitId: string) {
		const view = this.controller.editor;
		const entry = view ? lintMarks.list(view.state).find((candidate) => candidate.meta.id === hitId) : undefined;
		if (!view || !entry) return;
		view.dispatch({ selection: EditorSelection.range(entry.range.from, entry.range.to), effects: EditorView.scrollIntoView(entry.range.from, { y: "center" }) });
		view.focus();
	}

	ignore(view: EditorView, hitId: string) {
		const entry = lintMarks.list(view.state).find((candidate) => candidate.meta.id === hitId);
		if (!entry) return;
		const path = notePathOf(view) ?? "";
		this.ignoredFor(path).add(ignoreKey(entry.meta.ruleId, view.state.doc.sliceString(entry.range.from, entry.range.to)));
		view.dispatch({ effects: lintMarks.effects.remove.of([hitId]), annotations: noHistory });
	}

	applyFix(view: EditorView, hitId: string) {
		const entry = lintMarks.list(view.state).find((candidate) => candidate.meta.id === hitId);
		if (!entry || entry.meta.suggestion === undefined) return;
		view.dispatch(
			isolated({
				changes: { from: entry.range.from, to: entry.range.to, insert: entry.meta.suggestion },
				effects: lintMarks.effects.remove.of([hitId]),
				userEvent: VIKALP_EVENT.fix,
			}),
		);
	}

	async applyAllFixes() {
		const view = this.controller.editor;
		if (!view) return;
		const fixes = lintMarks.list(view.state).filter((entry) => entry.meta.source === "lab" && entry.meta.suggestion !== undefined);
		if (fixes.length === 0) return;
		const confirmed = await confirmAction(this.app, {
			title: "Apply all fixes?",
			body: `Applies ${fixes.length} punctuation and typo ${fixes.length === 1 ? "fix" : "fixes"} suggested by the AI. Undo reverts them all at once.`,
			confirmLabel: `Apply ${fixes.length}`,
		});
		if (!confirmed || this.controller.editor !== view) return;
		const current = lintMarks.list(view.state).filter((entry) => fixes.some((fix) => fix.meta.id === entry.meta.id));
		const changes: Array<{ from: number; to: number; insert: string }> = [];
		for (const entry of current) {
			if (changes.some((change) => change.from < entry.range.to && entry.range.from < change.to)) continue;
			changes.push({ from: entry.range.from, to: entry.range.to, insert: entry.meta.suggestion ?? "" });
		}
		view.dispatch(isolated({ changes, effects: lintMarks.effects.remove.of(current.map((entry) => entry.meta.id)), userEvent: VIKALP_EVENT.fix }));
	}

	/** Adds the selected phrase to a word list rule (creating "Pet peeves" by default). */
	async newRuleFromSelection(view: EditorView) {
		const selection = view.state.selection.main;
		const phrase = view.state.doc.sliceString(selection.from, selection.to).trim().replace(/\s+/g, " ");
		if (!phrase) {
			new Notice("Select the phrase you want flagged.");
			return;
		}
		const label = await promptText(this.app, {
			title: `Flag “${phrase.length > 40 ? `${phrase.slice(0, 39)}…` : phrase}”`,
			label: "Add it to the rule",
			value: "Pet peeves",
			confirmLabel: "Add rule",
		});
		if (!label?.trim()) return;
		const id = `my.${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rule"}`;
		const existing = this.rules.find((rule) => rule.id === id);
		let rule: WordlistRule;
		if (existing && existing.engine === "wordlist") {
			if (existing.tokens.some((token) => token.toLowerCase() === phrase.toLowerCase())) {
				new Notice(`“${phrase}” is already in ${existing.label}.`);
				return;
			}
			rule = { ...existing, tokens: [...existing.tokens, phrase] };
		} else {
			rule = {
				id,
				label: label.trim(),
				description: "Phrases you asked Vikalp to flag.",
				scope: "sentence",
				engine: "wordlist",
				severity: "warning",
				tokens: [phrase],
				ignorecase: true,
				message: `${label.trim()}: '%s'`,
			};
		}
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.rulesDir))) await adapter.mkdir(this.rulesDir);
		const { origin: _origin, ...toWrite } = rule;
		await adapter.write(`${this.rulesDir}/${id}.yaml`, serializeRule(toWrite as Rule));
		await this.loadRules();
		new Notice(`Added “${phrase}” to ${rule.label}.`);
		if (this.controller.editor === view) this.runLocal(view);
	}

	dispose() {
		this.runToken++;
		if (this.liveTimer !== null) window.clearTimeout(this.liveTimer);
		this.liveTimer = null;
	}

	/** Live mode: re-runs local rules a moment after typing stops. */
	handleEdit(view: EditorView, update: ViewUpdate) {
		if (!update.docChanged || !this.getSettings().liveLocalLint) return;
		if (!update.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"))) return;
		if (this.liveTimer !== null) window.clearTimeout(this.liveTimer);
		this.liveTimer = window.setTimeout(() => {
			this.liveTimer = null;
			if (this.controller.editor === view) this.runLocal(view);
		}, LIVE_LINT_DELAY_MS);
	}
}

/** Paragraph-level questions for a note-level rule that was flagged, so the panel can show which paragraphs. */
function paragraphFollowUps(noteTask: JudgmentTask, doc: string): JudgmentTask[] {
	const rule = noteTask.rule;
	if (rule.engine !== "classifier" || !rule.paragraphQuestion) return [];
	const paragraphRule: Rule = { ...rule, scope: "paragraph" };
	return segmentNote(doc)
		.filter((paragraph) => paragraph.kind !== "heading" && countWords(doc.slice(paragraph.from, paragraph.to)) >= 4)
		.map((paragraph) => {
			const unit = { from: paragraph.from, to: paragraph.to, text: doc.slice(paragraph.from, paragraph.to) };
			return { rule: paragraphRule, question: rule.paragraphQuestion!, threshold: rule.threshold, message: noteTask.message, unit, paragraph: unit };
		});
}

function ignoreKey(ruleId: string, text: string): string {
	return `${ruleId}|${text.trim().toLowerCase()}`;
}
