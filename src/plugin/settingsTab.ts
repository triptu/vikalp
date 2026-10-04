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
			.setDesc("Stored in this vault's plugin data, never in your notes. Nothing is sent anywhere until you click an AI action.")
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
				.addText((text) =>
					text.setValue(settings.models[mode]).onChange(async (value) => {
						settings.models[mode] = value.trim() || DEFAULT_SETTINGS.models[mode];
						await this.plugin.saveSettings();
					}),
				);
		}
		new Setting(containerEl)
			.setName("AI alternatives per request")
			.addSlider((slider) =>
				slider
					.setLimits(3, 8, 1)
					.setValue(settings.alternativesCount)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.alternativesCount = value;
						await this.plugin.saveSettings();
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
			.setDesc("Hover a marked span and press the arrow keys. Typing disarms it until the mouse moves again. Alt+↑/↓ always works with the cursor inside a span.")
			.addToggle((toggle) =>
				toggle.setValue(settings.hoverCycling).onChange(async (value) => {
					settings.hoverCycling = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Linter").setHeading();
		new Setting(containerEl)
			.setName("Judgment rules use")
			.setDesc("Rules like awkward, hedging in spirit or LinkedIn voice need judgment. Jev is fast and cheap and only answers yes or no. If Jev is unavailable, Vikalp falls back to the Lite model and tells you.")
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
			.setDesc("YAML rule files inside the plugin folder. Built-in rules are copied here so you can edit them.")
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
				.setDesc(`${rule.description ?? ""} (${rule.id} · ${rule.scope} · ${rule.engine}${rule.judgment ? " + judgment" : ""})`)
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
