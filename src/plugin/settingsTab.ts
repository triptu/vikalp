import { Platform, PluginSettingTab, type App, type ExtraButtonComponent, type Setting, type SettingDefinition, type SettingDefinitionItem } from "obsidian";
import type { ModelMode, VikalpSettings } from "../core/settings";
import { engineChoice } from "../core/rules/draft";
import { groupRulesByLabel, usesAi, type RuleFamily } from "../core/rules/groups";
import type { Rule } from "../core/rules/types";
import type VikalpPlugin from "../main";
import { AiSettingsSection } from "./aiSettings";
import { RuleEditorModal } from "./ruleEditor";

type PlainKey = "alternativesCount" | "markersOnByDefault" | "articleFix" | "hoverCycling" | "judgmentEngine" | "liveLocalLint" | "trimPrimaryAction";

interface ControlBinding {
	get: () => unknown;
	set: (value: unknown) => Promise<void>;
}

export class VikalpSettingTab extends PluginSettingTab {
	/** Rule families the user has expanded, kept while settings stay open. */
	private readonly expandedFamilies = new Set<string>();
	private readonly aiSection: AiSettingsSection;

	constructor(
		app: App,
		private readonly plugin: VikalpPlugin,
	) {
		super(app, plugin);
		this.containerEl.addClass("vk-settings");
		this.aiSection = new AiSettingsSection(
			plugin,
			() => this.update(),
			() => this.refreshDomState(),
		);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ type: "group", heading: "AI", items: this.aiSettings() },
			{ type: "group", heading: "Writing", items: this.writingSettings() },
			{ type: "group", heading: "Hotkeys", items: this.hotkeySettings() },
			{ type: "group", heading: "Linter", items: this.linterSettings() },
			{ type: "group", heading: "Lint rules", items: this.ruleSettings() },
			{ type: "group", heading: "Lab", items: this.labSettings() },
		];
	}

	override getControlValue(key: string): unknown {
		return this.binding(key).get();
	}

	override async setControlValue(key: string, value: unknown) {
		await this.binding(key).set(value);
	}

	private aiSettings(): SettingDefinition[] {
		return [
			...this.aiSection.definitions(),
			{
				name: "AI versions per request",
				desc: "How many versions Ask AI adds each time you use it.",
				control: { type: "slider", key: "alternativesCount", min: 3, max: 8, step: 1 },
			},
		];
	}

	private writingSettings(): SettingDefinition[] {
		return [
			{
				name: "Show markers in new notes",
				desc: "Markers are the underlines and dots on text that has versions or ghosts. When this is off, a new note shows no markers until you add alternatives or click the word count in the status bar.",
				control: { type: "toggle", key: "markersOnByDefault" },
			},
			{
				name: "Fix a/an when swapping versions",
				desc: "When you swap in a version, Vikalp also fixes the “a” or “an” before it. For example, “a thumbtack” becomes “an eraser”.",
				control: { type: "toggle", key: "articleFix" },
			},
			{
				name: "Cycle with arrow keys while hovering",
				desc: "Hover over text that has versions and press ↑ or ↓ to switch between them. Alt+↑ and Alt+↓ do the same at the cursor, even when this is off.",
				control: { type: "toggle", key: "hoverCycling" },
			},
		];
	}

	private hotkeySettings(): SettingDefinition[] {
		const keys = Platform.isMacOS ? { alternatives: "⌘J", askAi: "⌘⇧J", actions: "⌘." } : { alternatives: "Ctrl+J", askAi: "Ctrl+Shift+J", actions: "Ctrl+." };
		return [
			{
				name: "Use suggested hotkeys",
				desc: `Sets ${keys.alternatives} for alternatives, ${keys.askAi} to ask AI for versions, and ${keys.actions} for a list of every action. Off by default, so Vikalp doesn't take keys that you or another plugin already use.`,
				aliases: ["shortcuts", "keys", "keyboard"],
				control: { type: "toggle", key: "suggestedHotkeys" },
			},
			{
				name: "Change hotkeys",
				desc: "Set or change the key for any Vikalp command in Settings → Hotkeys.",
				aliases: ["shortcuts", "keyboard"],
				action: () => this.openHotkeys(),
			},
		];
	}

	private linterSettings(): SettingDefinition[] {
		return [
			{
				name: "AI rules use",
				desc: "Which model answers the AI rules. Jev is fast and cheap, and only answers yes or no. If Jev is down, Vikalp uses your Lite model and tells you.",
				aliases: ["judgment rules", "jev"],
				control: { type: "dropdown", key: "judgmentEngine", options: { jev: "Jev (TypeSafe)", llm: "The selected model" } },
				// Jev runs on OpenRouter only. Elsewhere AI rules always use the selected model.
				visible: () => this.plugin.ai.hasJev,
			},
			{
				name: "Run rules without AI as you type",
				desc: "Runs the rules that don't use AI again a moment after you stop typing. These rules are free and nothing leaves your machine. AI rules only run when you click Run linter.",
				aliases: ["lint as you type", "live lint", "local rules"],
				control: { type: "toggle", key: "liveLocalLint" },
			},
		];
	}

	private ruleSettings(): SettingDefinition[] {
		const rows: SettingDefinition[] = [
			{
				name: "Add a rule",
				desc: "A rule can flag a word or phrase, a pattern, or a measurement such as sentence length. It can also ask AI a yes or no question about your text.",
				aliases: ["new rule", "lint rules"],
				render: (setting) => {
					setting.addButton((button) =>
						button
							.setButtonText("Add rule")
							.setCta()
							.onClick(() => this.openEditor(null)),
					);
				},
			},
			{
				name: "Rule files",
				desc: "Each rule is saved as a file in the plugin's rules folder. You can edit the files in any text editor. Click Reload when you're done.",
				aliases: ["rules folder"],
				render: (setting) => {
					setting
						.addButton((button) => button.setButtonText("Open folder").onClick(() => this.plugin.linter.openRulesFolder()))
						.addButton((button) =>
							button.setButtonText("Reload").onClick(async () => {
								await this.plugin.linter.reloadRules();
								this.update();
							}),
						);
				},
			},
		];
		for (const family of groupRulesByLabel(this.plugin.linter.allRules())) {
			rows.push(this.familyRow(family));
			if (family.rules.length > 1) rows.push(...family.rules.map((rule) => this.checkRow(family, rule)));
		}
		return rows;
	}

	private familyRow(family: RuleFamily): SettingDefinition {
		const onCount = family.rules.filter((rule) => this.isOn(rule)).length;
		const single = family.rules.length === 1;
		const partial = onCount > 0 && onCount < family.rules.length ? ` ${onCount} of ${family.rules.length} checks on.` : "";
		return {
			name: family.label,
			desc: `${family.description}${partial}`,
			aliases: family.rules.flatMap((rule) => (rule.description ? [rule.description] : [])),
			render: (setting) => {
				setting.setClass("vk-rule-family");
				this.addTags(setting, family.rules);
				if (single) {
					setting.addExtraButton((button) => button.setIcon("pencil").setTooltip("Open and edit").onClick(() => this.openEditor(family.rules[0])));
				} else {
					let chevron: ExtraButtonComponent | null = null;
					const toggleExpanded = () => {
						if (this.expandedFamilies.has(family.label)) this.expandedFamilies.delete(family.label);
						else this.expandedFamilies.add(family.label);
						if (chevron) this.setChevron(chevron, family);
						this.refreshDomState();
					};
					setting.addExtraButton((button) => {
						chevron = button;
						this.setChevron(button, family);
						button.onClick(toggleExpanded);
					});
					setting.settingEl.addClass("mod-clickable");
					// Obsidian re-runs render on the same row after update(), so assign rather than add a listener.
					setting.infoEl.onclick = toggleExpanded;
				}
				setting.addToggle((toggle) => toggle.setValue(onCount > 0).onChange((enabled) => void this.setOn(family.rules, enabled)));
			},
		};
	}

	private checkRow(family: RuleFamily, rule: Rule): SettingDefinition {
		const details = [engineChoice(rule.engine).name, rule.judgment ? "plus an AI question" : "", rule.scope === "document" ? "whole note" : `each ${rule.scope}`].filter(Boolean).join(" · ");
		return {
			name: rule.description || rule.id,
			desc: this.plugin.linter.isEdited(rule.id) ? `${details} · edited` : details,
			aliases: [family.label],
			visible: () => this.expandedFamilies.has(family.label),
			render: (setting) => {
				setting.setClass("vk-rule-check");
				this.addTags(setting, [rule]);
				setting.addExtraButton((button) => button.setIcon("pencil").setTooltip("Open and edit").onClick(() => this.openEditor(rule)));
				setting.addToggle((toggle) => toggle.setValue(this.isOn(rule)).onChange((enabled) => void this.setOn([rule], enabled)));
			},
		};
	}

	private labSettings(): SettingDefinition[] {
		return [
			{
				name: "Main trim action",
				desc: "Which button comes first in the trim bar. Ghosting dims the words the model would cut and keeps them in the note. Making the cuts deletes them.",
				control: { type: "dropdown", key: "trimPrimaryAction", options: { ghost: "Ghost the cuts", cut: "Make the cuts" } },
			},
			{
				name: "Samples of your writing",
				aliases: ["voice", "voice reference notes", "tone"],
				desc: "Files from this vault that show how you write. Put one file per line, as a path or a file name. Only the Lab pass “Words that don't fit the tone” uses them. It sends the first 2,000 characters of each file to the model, together with the text you're working on. The model then marks words in your text that don't sound like you.",
				control: { type: "textarea", key: "voiceReferenceNotes", placeholder: "Essays/On writing.md", rows: 4 },
			},
		];
	}

	private binding(key: string): ControlBinding {
		const settings = this.plugin.settings;
		if (key === "suggestedHotkeys") return { get: () => settings.suggestedHotkeys, set: (value) => this.plugin.setSuggestedHotkeys(value === true) };
		if (key === "modelMode") return { get: () => settings.modelMode, set: (value) => this.plugin.setModelMode(value as ModelMode) };
		if (key === "voiceReferenceNotes") {
			return {
				get: () => settings.voiceReferenceNotes.join("\n"),
				set: (value) => {
					settings.voiceReferenceNotes = String(value)
						.split("\n")
						.map((line) => line.trim())
						.filter(Boolean);
					return this.plugin.saveSettings();
				},
			};
		}
		return this.plainBinding(key as PlainKey);
	}

	private plainBinding<K extends PlainKey>(key: K): ControlBinding {
		const settings = this.plugin.settings;
		return {
			get: () => settings[key],
			set: (value) => {
				settings[key] = value as VikalpSettings[K];
				return this.plugin.saveSettings();
			},
		};
	}

	private addTags(setting: Setting, rules: Rule[]) {
		if (rules.some((rule) => rule.origin === "user")) setting.nameEl.createSpan({ cls: "vk-rule-tag", text: "yours" });
		if (rules.some(usesAi)) setting.nameEl.createSpan({ cls: "vk-rule-tag is-ai", text: "AI" });
	}

	private setChevron(button: ExtraButtonComponent, family: RuleFamily) {
		const expanded = this.expandedFamilies.has(family.label);
		button.setIcon(expanded ? "chevron-down" : "chevron-right").setTooltip(expanded ? "Hide checks" : `Show ${family.rules.length} checks`);
	}

	private isOn(rule: Rule): boolean {
		return !this.plugin.settings.disabledRules.includes(rule.id);
	}

	private async setOn(rules: Rule[], enabled: boolean) {
		const settings = this.plugin.settings;
		const ids = new Set(rules.map((rule) => rule.id));
		settings.disabledRules = enabled ? settings.disabledRules.filter((id) => !ids.has(id)) : [...new Set([...settings.disabledRules, ...ids])];
		await this.plugin.saveSettings();
		this.update();
	}

	private openHotkeys() {
		// Obsidian has no public API for opening another settings tab; this is the one the app uses itself.
		const setting = (this.app as unknown as { setting?: { openTabById: (id: string) => { setQuery?: (query: string) => void } | undefined } }).setting;
		setting?.openTabById("hotkeys")?.setQuery?.(this.plugin.manifest.name);
	}

	private openEditor(rule: Rule | null) {
		new RuleEditorModal(this.app, this.plugin.linter, rule, () => this.update()).open();
	}
}
