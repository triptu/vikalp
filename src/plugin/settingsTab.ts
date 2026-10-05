import { PluginSettingTab, Setting, type App } from "obsidian";
import { AI_PROVIDER_LABELS, DEFAULT_SETTINGS, MODEL_MODE_LABELS, type AiProvider, type ModelMode } from "../core/settings";
import { engineChoice } from "../core/rules/draft";
import { groupRulesByLabel, usesAi } from "../core/rules/groups";
import type { Rule } from "../core/rules/types";
import type VikalpPlugin from "../main";
import { RuleEditorModal } from "./ruleEditor";

export class VikalpSettingTab extends PluginSettingTab {
	/** Rule families the user has expanded, kept while settings stay open. */
	private readonly expandedFamilies = new Set<string>();

	constructor(
		app: App,
		private readonly plugin: VikalpPlugin,
	) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		const scrollTop = containerEl.scrollTop;
		containerEl.empty();
		window.requestAnimationFrame(() => (containerEl.scrollTop = scrollTop));
		containerEl.addClass("vk-settings");

		new Setting(containerEl).setName("AI").setHeading();
		new Setting(containerEl)
			.setName("AI provider")
			.setDesc("Sign in with a ChatGPT plan, or use an OpenRouter key. Either way nothing runs until you click an AI action.")
			.addDropdown((dropdown) => {
				for (const provider of ["chatgpt", "openrouter"] as AiProvider[]) dropdown.addOption(provider, AI_PROVIDER_LABELS[provider]);
				dropdown.setValue(settings.aiProvider).onChange(async (value) => {
					settings.aiProvider = value as AiProvider;
					await this.plugin.saveSettings();
					this.display();
				});
			});
		if (settings.aiProvider === "chatgpt") this.renderChatGptSignIn(containerEl);
		else this.renderOpenRouterKey(containerEl);
		new Setting(containerEl)
			.setName("Model mode")
			.setDesc("Applies to every AI action. Lite is fast and cheap for drafting; Heavy is for the final pass.")
			.addDropdown((dropdown) => {
				for (const mode of ["lite", "medium", "heavy"] as ModelMode[]) dropdown.addOption(mode, MODEL_MODE_LABELS[mode]);
				dropdown.setValue(settings.modelMode).onChange(async (value) => this.plugin.setModelMode(value as ModelMode));
			});
		const onChatGpt = settings.aiProvider === "chatgpt";
		const modelIds = onChatGpt ? settings.chatgptModels : settings.models;
		const defaultIds = onChatGpt ? DEFAULT_SETTINGS.chatgptModels : DEFAULT_SETTINGS.models;
		for (const mode of ["lite", "medium", "heavy"] as ModelMode[]) {
			new Setting(containerEl)
				.setName(`${MODEL_MODE_LABELS[mode]} model`)
				.setDesc(`${AI_PROVIDER_LABELS[settings.aiProvider]} model id. Default: ${defaultIds[mode]}`)
				.addText((text) => {
					text.inputEl.addClass("vk-settings-key");
					text.setValue(modelIds[mode]).onChange(async (value) => {
						modelIds[mode] = value.trim() || defaultIds[mode];
						await this.plugin.saveSettings();
					});
				});
		}
		new Setting(containerEl)
			.setName("AI versions per request")
			.setDesc(`${settings.alternativesCount} at a time.`)
			.addSlider((slider) =>
				slider
					.setLimits(3, 8, 1)
					.setValue(settings.alternativesCount)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.alternativesCount = value;
						await this.plugin.saveSettings();
						slider.sliderEl.closest(".setting-item")?.querySelector(".setting-item-description")?.setText(`${value} at a time.`);
					}),
			);
		new Setting(containerEl).setName("Writing").setHeading();
		new Setting(containerEl)
			.setName("Show markers in new notes")
			.setDesc("Off keeps notes looking plain until you click the word count or add alternatives.")
			.addToggle((toggle) =>
				toggle.setValue(settings.markersOnByDefault).onChange(async (value) => {
					settings.markersOnByDefault = value;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Fix a/an when swapping versions")
			.setDesc("“a thumbtack” becomes “an eraser” as part of the same edit.")
			.addToggle((toggle) =>
				toggle.setValue(settings.articleFix).onChange(async (value) => {
					settings.articleFix = value;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Cycle with arrow keys while hovering")
			.setDesc("Hover a marked word and press the arrow keys. Alt+↑/↓ works from the cursor.")
			.addToggle((toggle) =>
				toggle.setValue(settings.hoverCycling).onChange(async (value) => {
					settings.hoverCycling = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Linter").setHeading();
		new Setting(containerEl)
			.setName("Judgment rules use")
			.setDesc("Jev is fast, cheap and only answers yes or no, but it needs an OpenRouter key. If it's down or you use ChatGPT, Vikalp uses the Lite model.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("jev", "Jev (TypeSafe)")
					.addOption("llm", "The selected model")
					.setValue(settings.judgmentEngine)
					.onChange(async (value) => {
						settings.judgmentEngine = value as "jev" | "llm";
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Lint as you type")
			.setDesc("Re-runs the free local rules a moment after you stop typing. Judgment rules never run live.")
			.addToggle((toggle) =>
				toggle.setValue(settings.liveLocalLint).onChange(async (value) => {
					settings.liveLocalLint = value;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Rules folder")
			.setDesc("Where rule files live, inside the plugin folder. You can edit them here or in any text editor.")
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
						this.display();
					}),
			);

		this.renderRules(containerEl);

		new Setting(containerEl).setName("Lab").setHeading();
		new Setting(containerEl)
			.setName("Main trim action")
			.setDesc("Which button leads in the trim bar. Ghosting keeps the cut words, dimmed, until you delete them.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("ghost", "Ghost the cuts")
					.addOption("cut", "Make the cuts")
					.setValue(settings.trimPrimaryAction)
					.onChange(async (value) => {
						settings.trimPrimaryAction = value as "ghost" | "cut";
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Voice reference notes")
			.setDesc("Notes that sound like you, one path per line. The tone pass compares against them.")
			.addTextArea((text) => {
				text.inputEl.rows = 4;
				text.inputEl.addClass("vk-settings-textarea");
				text
					.setPlaceholder("Essays/On writing.md")
					.setValue(settings.voiceReferenceNotes.join("\n"))
					.onChange(async (value) => {
						settings.voiceReferenceNotes = value
							.split("\n")
							.map((line) => line.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					});
			});
	}

	private renderOpenRouterKey(containerEl: HTMLElement) {
		const settings = this.plugin.settings;
		new Setting(containerEl)
			.setName("OpenRouter API key")
			.setDesc("Kept in plugin data, not in your notes. Used only when you click an AI action.")
			.addText((text) => {
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
	}

	private renderChatGptSignIn(containerEl: HTMLElement) {
		const signedIn = this.plugin.settings.chatgptCredential !== null;
		const row = new Setting(containerEl)
			.setName("ChatGPT")
			.setDesc(
				signedIn
					? "Signed in. AI actions use your ChatGPT plan, not an API bill. Tokens are kept in plugin data, not in your notes."
					: "Needs a ChatGPT Plus or Pro plan. Opens your browser; Vikalp keeps the sign-in on this computer.",
			);
		if (signedIn) {
			row.addButton((button) =>
				button.setButtonText("Sign out").onClick(async () => {
					await this.plugin.signOutOfChatGpt();
					this.display();
				}),
			);
		} else {
			row.addButton((button) =>
				button
					.setButtonText("Sign in with ChatGPT")
					.setCta()
					.onClick(async () => {
						if (await this.plugin.signInToChatGpt()) this.display();
					}),
			);
		}
	}

	private renderRules(containerEl: HTMLElement) {
		const linter = this.plugin.linter;
		const settings = this.plugin.settings;
		new Setting(containerEl)
			.setName("Rules")
			.setDesc("Each rule can be switched off, opened and edited. Rules with the same name are grouped.")
			.addButton((button) =>
				button
					.setButtonText("Add rule")
					.setCta()
					.onClick(() => this.openEditor(null)),
			);

		const list = containerEl.createDiv({ cls: "vk-settings-rules" });
		const isOn = (rule: Rule) => !settings.disabledRules.includes(rule.id);
		const setOn = async (rules: Rule[], enabled: boolean) => {
			const ids = new Set(rules.map((rule) => rule.id));
			settings.disabledRules = enabled ? settings.disabledRules.filter((id) => !ids.has(id)) : [...new Set([...settings.disabledRules, ...ids])];
			await this.plugin.saveSettings();
			this.display();
		};

		for (const family of groupRulesByLabel(linter.allRules())) {
			const onCount = family.rules.filter(isOn).length;
			const single = family.rules.length === 1;
			const expanded = this.expandedFamilies.has(family.label);
			const familyRow = new Setting(list).setClass("vk-rule-family");
			familyRow.nameEl.setText(family.label);
			if (family.rules.some((rule) => rule.origin === "user")) familyRow.nameEl.createSpan({ cls: "vk-rule-tag", text: "yours" });
			if (family.rules.some(usesAi)) familyRow.nameEl.createSpan({ cls: "vk-rule-tag is-ai", text: "AI" });
			const partial = onCount > 0 && onCount < family.rules.length ? ` ${onCount} of ${family.rules.length} checks on.` : "";
			familyRow.setDesc(`${family.description}${partial}`);
			if (single) {
				familyRow.addExtraButton((button) => button.setIcon("pencil").setTooltip("Open and edit").onClick(() => this.openEditor(family.rules[0])));
			} else {
				familyRow.addExtraButton((button) =>
					button
						.setIcon(expanded ? "chevron-down" : "chevron-right")
						.setTooltip(expanded ? "Hide checks" : `Show ${family.rules.length} checks`)
						.onClick(() => {
							if (expanded) this.expandedFamilies.delete(family.label);
							else this.expandedFamilies.add(family.label);
							this.display();
						}),
				);
			}
			familyRow.addToggle((toggle) => toggle.setValue(onCount > 0).onChange((enabled) => void setOn(family.rules, enabled)));
			if (!single) {
				familyRow.settingEl.addClass("mod-clickable");
				familyRow.infoEl.addEventListener("click", () => {
					if (expanded) this.expandedFamilies.delete(family.label);
					else this.expandedFamilies.add(family.label);
					this.display();
				});
			}
			if (single || !expanded) continue;

			const checks = list.createDiv({ cls: "vk-rule-checks" });
			for (const rule of family.rules) {
				const row = new Setting(checks).setClass("vk-rule-check");
				row.setName(rule.description || rule.id);
				if (usesAi(rule)) row.nameEl.createSpan({ cls: "vk-rule-tag is-ai", text: "AI" });
				if (rule.origin === "user") row.nameEl.createSpan({ cls: "vk-rule-tag", text: "yours" });
				const details = [engineChoice(rule.engine).name, rule.judgment ? "plus an AI question" : "", rule.scope === "document" ? "whole note" : `each ${rule.scope}`]
					.filter(Boolean)
					.join(" · ");
				row.setDesc(linter.isEdited(rule.id) ? `${details} · edited` : details);
				row.addExtraButton((button) => button.setIcon("pencil").setTooltip("Open and edit").onClick(() => this.openEditor(rule)));
				row.addToggle((toggle) => toggle.setValue(isOn(rule)).onChange((enabled) => void setOn([rule], enabled)));
			}
		}
	}

	private openEditor(rule: Rule | null) {
		new RuleEditorModal(this.app, this.plugin.linter, rule, () => this.display()).open();
	}
}
