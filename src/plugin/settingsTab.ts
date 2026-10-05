import { Platform, PluginSettingTab, type App, type ExtraButtonComponent, type Setting, type SettingDefinition, type SettingDefinitionItem } from "obsidian";
import { DEFAULT_SETTINGS, MODEL_MODE_LABELS, type ModelMode, type VikalpSettings } from "../core/settings";
import { engineChoice } from "../core/rules/draft";
import { groupRulesByLabel, usesAi, type RuleFamily } from "../core/rules/groups";
import type { Rule } from "../core/rules/types";
import type VikalpPlugin from "../main";
import { RuleEditorModal } from "./ruleEditor";

const MODEL_MODES: ModelMode[] = ["lite", "medium", "heavy"];

type PlainKey = "alternativesCount" | "markersOnByDefault" | "articleFix" | "hoverCycling" | "judgmentEngine" | "liveLocalLint" | "trimPrimaryAction";

interface ControlBinding {
	get: () => unknown;
	set: (value: unknown) => Promise<void>;
}

export class VikalpSettingTab extends PluginSettingTab {
	/** Rule families the user has expanded, kept while settings stay open. */
	private readonly expandedFamilies = new Set<string>();

	constructor(
		app: App,
		private readonly plugin: VikalpPlugin,
	) {
		super(app, plugin);
		this.containerEl.addClass("vk-settings");
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ type: "group", heading: "AI", items: this.aiSettings() },
			{ type: "group", heading: "Writing", items: this.writingSettings() },
			{ type: "group", heading: "Hotkeys", items: this.hotkeySettings() },
			{ type: "group", heading: "Linter", items: [...this.linterSettings(), ...this.ruleSettings()] },
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
		const settings = this.plugin.settings;
		return [
			{
				name: "OpenRouter API key",
				desc: "Kept in plugin data, not in your notes. Used only when you click an AI action.",
				aliases: ["key", "token"],
				render: (setting) => {
					setting.addText((text) => {
						text.inputEl.type = "password";
						text.inputEl.addClass("vk-settings-key");
						text
							.setPlaceholder("sk-or-…")
							.setValue(settings.openRouterApiKey)
							.onChange(async (value) => {
								settings.openRouterApiKey = value.trim();
								await this.plugin.saveSettings();
							});
					});
				},
			},
			{
				name: "Model mode",
				desc: "Applies to every AI action. Lite is fast and cheap for drafting; Heavy is for the final pass.",
				control: { type: "dropdown", key: "modelMode", options: Object.fromEntries(MODEL_MODES.map((mode) => [mode, MODEL_MODE_LABELS[mode]])) },
			},
			...MODEL_MODES.map(
				(mode): SettingDefinition => ({
					name: `${MODEL_MODE_LABELS[mode]} model`,
					desc: `OpenRouter model id. Default: ${DEFAULT_SETTINGS.models[mode]}`,
					control: { type: "text", key: `models.${mode}`, placeholder: DEFAULT_SETTINGS.models[mode] },
				}),
			),
			{
				name: "AI versions per request",
				desc: "How many versions Ask AI adds at a time.",
				control: { type: "slider", key: "alternativesCount", min: 3, max: 8, step: 1 },
			},
		];
	}

	private writingSettings(): SettingDefinition[] {
		return [
			{
				name: "Show markers in new notes",
				desc: "Off keeps notes looking plain until you click the word count or add alternatives.",
				control: { type: "toggle", key: "markersOnByDefault" },
			},
			{
				name: "Fix a/an when swapping versions",
				desc: "“a thumbtack” becomes “an eraser” as part of the same edit.",
				control: { type: "toggle", key: "articleFix" },
			},
			{
				name: "Cycle with arrow keys while hovering",
				desc: "Hover a marked word and press the arrow keys. Alt+↑/↓ works from the cursor.",
				control: { type: "toggle", key: "hoverCycling" },
			},
		];
	}

	private hotkeySettings(): SettingDefinition[] {
		const keys = Platform.isMacOS ? { alternatives: "⌘J", askAi: "⌘⇧J", actions: "⌘." } : { alternatives: "Ctrl+J", askAi: "Ctrl+Shift+J", actions: "Ctrl+." };
		return [
			{
				name: "Use suggested hotkeys",
				desc: `${keys.alternatives} for alternatives, ${keys.askAi} to ask AI, and ${keys.actions} for every other action. Off by default so Vikalp never takes keys you or another plugin use.`,
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
		const settings = this.plugin.settings;
		return [
			{
				name: "Judgment rules use",
				desc: "Jev is fast, cheap and only answers yes or no. If it's down, Vikalp uses the Lite model and tells you.",
				control: { type: "dropdown", key: "judgmentEngine", options: { jev: "Jev (TypeSafe)", llm: "The selected model" } },
			},
			{
				name: "Lint as you type",
				desc: "Re-runs the free local rules a moment after you stop typing. Judgment rules never run live.",
				control: { type: "toggle", key: "liveLocalLint" },
			},
			{
				name: "Rules folder",
				desc: "Where rule files live, inside the plugin folder. You can edit them here or in any text editor.",
				render: (setting) => {
					setting
						.addText((text) =>
							text.setValue(settings.rulesFolder).onChange(async (value) => {
								settings.rulesFolder = value.trim().replace(/^\/+|\/+$/g, "") || DEFAULT_SETTINGS.rulesFolder;
								await this.plugin.saveSettings();
							}),
						)
						.addExtraButton((button) => button.setIcon("folder-open").setTooltip("Open the rules folder").onClick(() => this.plugin.linter.openRulesFolder()))
						.addExtraButton((button) =>
							button
								.setIcon("refresh-cw")
								.setTooltip("Reload rule files")
								.onClick(async () => {
									await this.plugin.linter.reloadRules();
									this.update();
								}),
						);
				},
			},
		];
	}

	private ruleSettings(): SettingDefinition[] {
		const rows: SettingDefinition[] = [
			{
				name: "Rules",
				desc: "Each rule can be switched off, opened and edited. Rules with the same name are grouped.",
				aliases: ["lint rules", "add rule"],
				render: (setting) => {
					setting.addButton((button) =>
						button
							.setButtonText("Add rule")
							.setCta()
							.onClick(() => this.openEditor(null)),
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
				desc: "Which button leads in the trim bar. Ghosting keeps the cut words, dimmed, until you delete them.",
				control: { type: "dropdown", key: "trimPrimaryAction", options: { ghost: "Ghost the cuts", cut: "Make the cuts" } },
			},
			{
				name: "Voice reference notes",
				desc: "Notes that sound like you, one path per line. The tone pass compares against them.",
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
		const mode = MODEL_MODES.find((candidate) => key === `models.${candidate}`);
		if (mode) {
			return {
				get: () => settings.models[mode],
				set: (value) => {
					settings.models[mode] = String(value).trim() || DEFAULT_SETTINGS.models[mode];
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
