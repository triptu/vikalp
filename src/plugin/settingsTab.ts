import { PluginSettingTab, Setting, type App } from "obsidian";
import { DEFAULT_SETTINGS, MODEL_MODE_LABELS, type ModelMode } from "../core/settings";
import type VikalpPlugin from "../main";

export class VikalpSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: VikalpPlugin,
	) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		containerEl.empty();
		containerEl.addClass("vk-settings");

		new Setting(containerEl).setName("AI").setHeading();
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
		new Setting(containerEl)
			.setName("Model mode")
			.setDesc("Applies to every AI action. Lite is fast and cheap for drafting; Heavy is for the final pass.")
			.addDropdown((dropdown) => {
				for (const mode of ["lite", "medium", "heavy"] as ModelMode[]) dropdown.addOption(mode, MODEL_MODE_LABELS[mode]);
				dropdown.setValue(settings.modelMode).onChange(async (value) => this.plugin.setModelMode(value as ModelMode));
			});
		for (const mode of ["lite", "medium", "heavy"] as ModelMode[]) {
			new Setting(containerEl)
				.setName(`${MODEL_MODE_LABELS[mode]} model`)
				.setDesc(`OpenRouter model id. Default: ${DEFAULT_SETTINGS.models[mode]}`)
				.addText((text) => {
					text.inputEl.addClass("vk-settings-key");
					text.setValue(settings.models[mode]).onChange(async (value) => {
						settings.models[mode] = value.trim() || DEFAULT_SETTINGS.models[mode];
						await this.plugin.saveSettings();
					});
				});
		}
		new Setting(containerEl)
			.setName("AI alternatives per request")
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
		new Setting(containerEl)
			.setName("Show cost in the status bar")
			.setDesc("The session's AI spend. Click it for a log of every call.")
			.addToggle((toggle) =>
				toggle.setValue(settings.showCost).onChange(async (value) => {
					settings.showCost = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Writing").setHeading();
		new Setting(containerEl)
			.setName("Show markers in new notes")
			.setDesc("Off keeps notes looking plain until you click the word count or create a span.")
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
			.setDesc("Hover a span and press the arrow keys. Alt+↑/↓ works from the cursor.")
			.addToggle((toggle) =>
				toggle.setValue(settings.hoverCycling).onChange(async (value) => {
					settings.hoverCycling = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Linter").setHeading();
		new Setting(containerEl)
			.setName("Judgment rules use")
			.setDesc("Jev is fast, cheap and only answers yes or no. If it's down, Vikalp uses the Lite model and tells you.")
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
			.setDesc("Folder inside the plugin folder for YAML rule files. Built-in rules are copied here so you can edit them.")
			.addText((text) =>
				text.setValue(settings.rulesFolder).onChange(async (value) => {
					settings.rulesFolder = value.trim().replace(/^\/+|\/+$/g, "") || DEFAULT_SETTINGS.rulesFolder;
					await this.plugin.saveSettings();
				}),
			)
			.addButton((button) => button.setButtonText("Open folder").onClick(() => this.plugin.linter.openRulesFolder()))
			.addButton((button) =>
				button.setButtonText("Reload rules").onClick(async () => {
					await this.plugin.linter.reloadRules();
					this.display();
				}),
			);

		const rulesContainer = containerEl.createDiv({ cls: "vk-settings-rules" });
		for (const rule of this.plugin.linter.allRules()) {
			const disabled = settings.disabledRules.includes(rule.id);
			new Setting(rulesContainer)
				.setName(rule.label)
				.setDesc(`${rule.description ?? ""}${rule.engine === "classifier" || rule.engine === "llm" || rule.judgment ? " Uses AI judgment." : ""}`)
				.addToggle((toggle) =>
					toggle.setValue(!disabled).onChange(async (enabled) => {
						settings.disabledRules = enabled ? settings.disabledRules.filter((id) => id !== rule.id) : [...settings.disabledRules, rule.id];
						await this.plugin.saveSettings();
					}),
				);
		}

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
}
