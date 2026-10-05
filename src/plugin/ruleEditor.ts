import { Modal, Setting, type App } from "obsidian";
import type { LintScope, Severity } from "../core/model/types";
import { ENGINE_CHOICES, METRIC_CHOICES, draftFromRule, emptyDraft, engineChoice, newRuleId, ruleFromDraft, type RuleDraft } from "../core/rules/draft";
import { METRIC_SCOPES } from "../core/rules/parse";
import type { MetricName, Rule, RuleEngineName } from "../core/rules/types";
import type { LinterService } from "./linterService";
import { confirmAction } from "./modals";

const SCOPE_NAMES: Record<LintScope, string> = { sentence: "Each sentence", paragraph: "Each paragraph", document: "The whole note" };
const SEVERITY_NAMES: Record<Severity, string> = { suggestion: "Suggestion (blue)", warning: "Warning (yellow)", error: "Error (red)" };
const PREVIEW_DELAY_MS = 300;

/**
 * Edits one lint rule in a form, or creates a new one. Saving writes the
 * rule's YAML file; the form checks it with the same validation as the file.
 */
export class RuleEditorModal extends Modal {
	private draft: RuleDraft;
	private readonly isNew: boolean;
	private readonly isBuiltin: boolean;
	private fieldsEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private errorsEl!: HTMLElement;
	private saveButton: HTMLButtonElement | null = null;
	private previewTimer: number | null = null;

	constructor(
		app: App,
		private readonly linter: LinterService,
		rule: Rule | null,
		private readonly onSaved: () => void,
	) {
		super(app);
		this.isNew = rule === null;
		this.isBuiltin = rule?.origin === "builtin";
		this.draft = rule ? draftFromRule(rule) : emptyDraft("");
	}

	override onOpen() {
		this.modalEl.addClass("vk-rule-editor");
		this.titleEl.setText(this.isNew ? "New lint rule" : `Edit rule · ${this.draft.label}`);
		this.fieldsEl = this.contentEl.createDiv({ cls: "vk-rule-fields" });
		const footer = this.contentEl.createDiv({ cls: "vk-rule-footer" });
		this.previewEl = footer.createDiv({ cls: "vk-rule-preview" });
		this.errorsEl = footer.createDiv({ cls: "vk-rule-errors" });
		this.renderFields();
		this.renderButtons(footer);
		this.refresh();
	}

	override onClose() {
		if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
		this.contentEl.empty();
	}

	private update(patch: Partial<RuleDraft>, rerender = false) {
		this.draft = { ...this.draft, ...patch };
		if (rerender) this.renderFields();
		if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
		this.previewTimer = window.setTimeout(() => this.refresh(), PREVIEW_DELAY_MS);
	}

	private renderFields() {
		const container = this.fieldsEl;
		container.empty();
		const draft = this.draft;

		new Setting(container).setName("Name").setDesc("Rules with the same name are grouped together in settings and the Lint panel.").addText((text) =>
			text
				.setPlaceholder("Corporate speak")
				.setValue(draft.label)
				.onChange((label) => this.update({ label })),
		);
		new Setting(container).setName("What it catches").setDesc("One line, shown in settings.").addText((text) => {
			text.inputEl.addClass("vk-rule-wide");
			text.setValue(draft.description).onChange((description) => this.update({ description }));
		});

		const kind = engineChoice(draft.engine);
		new Setting(container)
			.setName("Kind")
			.setDesc(kind.hint)
			.addDropdown((dropdown) => {
				for (const choice of ENGINE_CHOICES) dropdown.addOption(choice.engine, choice.name);
				dropdown.setValue(draft.engine).onChange((engine) => {
					const scope = engine === "metric" && !METRIC_SCOPES[draft.metric].includes(draft.scope) ? METRIC_SCOPES[draft.metric][0] : draft.scope;
					this.update({ engine: engine as RuleEngineName, scope }, true);
				});
			});

		this.renderEngineFields(container);

		new Setting(container).setName("Looks at").addDropdown((dropdown) => {
			const scopes = draft.engine === "metric" ? METRIC_SCOPES[draft.metric] : (Object.keys(SCOPE_NAMES) as LintScope[]);
			for (const scope of scopes) dropdown.addOption(scope, SCOPE_NAMES[scope]);
			dropdown.setValue(draft.scope).onChange((scope) => this.update({ scope: scope as LintScope }, draft.engine === "classifier"));
		});
		new Setting(container).setName("Shown as").addDropdown((dropdown) => {
			for (const severity of Object.keys(SEVERITY_NAMES) as Severity[]) dropdown.addOption(severity, SEVERITY_NAMES[severity]);
			dropdown.setValue(draft.severity).onChange((severity) => this.update({ severity: severity as Severity }));
		});
		new Setting(container)
			.setName("Message")
			.setDesc(draft.engine === "metric" ? "%s becomes what was measured, like “38 words”." : "%s becomes the matched text.")
			.addText((text) => {
				text.inputEl.addClass("vk-rule-wide");
				text
					.setPlaceholder(draft.engine === "substitution" ? "Wordy: '%s'. Try '%r'." : "Corporate speak: '%s'")
					.setValue(draft.message)
					.onChange((message) => this.update({ message }));
			});

		if (draft.engine !== "classifier" && draft.engine !== "llm") this.renderAiCheck(container);
	}

	private renderEngineFields(container: HTMLElement) {
		const draft = this.draft;
		const textarea = (name: string, desc: string, value: string, placeholder: string, onChange: (value: string) => void) =>
			new Setting(container)
				.setName(name)
				.setDesc(desc)
				.addTextArea((text) => {
					text.inputEl.rows = 6;
					text.inputEl.addClass("vk-rule-textarea");
					text.setPlaceholder(placeholder).setValue(value).onChange(onChange);
				});
		const ignoreCase = () =>
			new Setting(container).setName("Ignore case").addToggle((toggle) => toggle.setValue(draft.ignoreCase).onChange((value) => this.update({ ignoreCase: value })));

		switch (draft.engine) {
			case "wordlist":
				textarea("Phrases", "One per line.", draft.phrases, "synergy\ncircle back\nmove the needle", (phrases) => this.update({ phrases }));
				ignoreCase();
				break;
			case "substitution":
				textarea("Phrases and fixes", "One per line: phrase → fix. Leave the fix empty to suggest cutting it.", draft.fixes, "utilize → use\nin order to → to\nvery →", (fixes) =>
					this.update({ fixes }),
				);
				ignoreCase();
				break;
			case "regex":
				textarea("Patterns", "One JavaScript regular expression per line. Each match is a mark.", draft.patterns, "\\bnot just\\b[^.]*\\bbut\\b", (patterns) =>
					this.update({ patterns }),
				);
				ignoreCase();
				break;
			case "metric":
				new Setting(container).setName("Measure").addDropdown((dropdown) => {
					for (const choice of METRIC_CHOICES) dropdown.addOption(choice.metric, choice.name);
					dropdown.setValue(draft.metric).onChange((value) => {
						const metric = value as MetricName;
						const scope = METRIC_SCOPES[metric].includes(draft.scope) ? draft.scope : METRIC_SCOPES[metric][0];
						this.update({ metric, scope }, true);
					});
				});
				new Setting(container)
					.setName("Flag when above")
					.addText((text) => text.setValue(draft.max).onChange((max) => this.update({ max })));
				new Setting(container)
					.setName("Skip units shorter than")
					.setDesc("In words. Leave empty to check everything.")
					.addText((text) => text.setPlaceholder("0").setValue(draft.minWords).onChange((minWords) => this.update({ minWords })));
				break;
			case "classifier":
				textarea("Question", "A yes/no question about the text. Ordinary writing should get a clear “no”.", draft.question, "Does this sentence read as emotionally cold or detached?", (question) =>
					this.update({ question }),
				);
				this.thresholdSetting(container, "Flag when the chance of “yes” is at least", draft.threshold, (threshold) => this.update({ threshold }));
				if (draft.scope === "document") {
					textarea(
						"Then ask each paragraph",
						"Optional. When the whole note is flagged, this question finds which paragraphs are behind it.",
						draft.paragraphQuestion,
						"Does this paragraph read like part of a LinkedIn post?",
						(paragraphQuestion) => this.update({ paragraphQuestion }),
					);
				}
				break;
			case "llm":
				textarea("Instructions", "What the model should look for. It quotes matching text with a short reason.", draft.prompt, "Mark claims that need a source.", (prompt) =>
					this.update({ prompt }),
				);
				break;
		}
	}

	private renderAiCheck(container: HTMLElement) {
		const draft = this.draft;
		new Setting(container)
			.setName("Also ask AI")
			.setDesc("Adds a yes/no question that catches what the list or limit misses. Costs a little per run.")
			.addToggle((toggle) => toggle.setValue(draft.aiCheck).onChange((aiCheck) => this.update({ aiCheck }, true)));
		if (!draft.aiCheck) return;
		new Setting(container).setName("Question").addTextArea((text) => {
			text.inputEl.rows = 2;
			text.inputEl.addClass("vk-rule-textarea");
			text
				.setPlaceholder("Does this sentence hedge or soften its claim more than it needs to?")
				.setValue(draft.aiQuestion)
				.onChange((aiQuestion) => this.update({ aiQuestion }));
		});
		this.thresholdSetting(container, "Flag when the chance of “yes” is at least", draft.aiThreshold, (aiThreshold) => this.update({ aiThreshold }));
		new Setting(container).setName("Message for AI marks").addText((text) => text.setValue(draft.aiMessage).onChange((aiMessage) => this.update({ aiMessage })));
	}

	private thresholdSetting(container: HTMLElement, name: string, value: number, onChange: (value: number) => void) {
		const setting = new Setting(container).setName(name).setDesc(`${Math.round(value * 100)}%`);
		setting.addSlider((slider) =>
			slider
				.setLimits(0.5, 0.95, 0.05)
				.setValue(value)
				.onChange((next) => {
					setting.setDesc(`${Math.round(next * 100)}%`);
					onChange(next);
				}),
		);
	}

	private renderButtons(footer: HTMLElement) {
		const buttons = new Setting(footer).setClass("vk-rule-buttons");
		if (!this.isNew && !this.isBuiltin) {
			buttons.addButton((button) =>
				button
					.setButtonText("Delete rule")
					.setWarning()
					.onClick(async () => {
						const confirmed = await confirmAction(this.app, { title: "Delete this rule?", body: `“${this.draft.label}” will be removed from your rules folder.`, confirmLabel: "Delete", warning: true });
						if (!confirmed) return;
						await this.linter.deleteRule(this.draft.id);
						this.onSaved();
						this.close();
					}),
			);
		}
		if (this.isBuiltin && this.linter.isEdited(this.draft.id)) {
			buttons.addButton((button) =>
				button.setButtonText("Reset to built-in").onClick(async () => {
					await this.linter.resetRule(this.draft.id);
					this.onSaved();
					this.close();
				}),
			);
		}
		buttons.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
		buttons.addButton((button) => {
			this.saveButton = button.buttonEl;
			button
				.setButtonText(this.isNew ? "Add rule" : "Save")
				.setCta()
				.onClick(() => void this.save());
		});
	}

	private withId(): RuleDraft {
		if (!this.isNew) return this.draft;
		const taken = new Set(this.linter.allRules().map((rule) => rule.id));
		return { ...this.draft, id: newRuleId(this.draft.label || "rule", taken) };
	}

	private refresh() {
		this.previewTimer = null;
		const result = ruleFromDraft(this.withId());
		this.errorsEl.empty();
		this.previewEl.empty();
		if (this.saveButton) this.saveButton.disabled = !result.ok;
		if (!result.ok) {
			for (const error of result.errors) this.errorsEl.createDiv({ text: error });
			return;
		}
		const preview = this.linter.previewHits(result.rule);
		if (!preview) {
			this.previewEl.setText(result.rule.engine === "classifier" || result.rule.engine === "llm" ? "AI rules run when you run the linter." : "Open a note to preview this rule.");
			return;
		}
		const noun = preview.count === 1 ? "mark" : "marks";
		this.previewEl.createSpan({ cls: "vk-rule-preview-count", text: `On the open note: ${preview.count} ${noun}` });
		if (preview.examples.length) this.previewEl.createSpan({ cls: "vk-rule-preview-examples", text: ` · ${preview.examples.map((example) => `“${example}”`).join(", ")}` });
	}

	private async save() {
		const result = ruleFromDraft(this.withId());
		if (!result.ok) return;
		await this.linter.saveRule(result.rule);
		this.onSaved();
		this.close();
	}
}
