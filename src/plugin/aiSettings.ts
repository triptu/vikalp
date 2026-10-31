import { debounce, type ExtraButtonComponent, type Setting, type SettingDefinition } from "obsidian";
import { AiError } from "../ai/aiClient";
import { familyChoices, type ModelChoice } from "../core/modelChoices";
import { PROVIDER_IDS, PROVIDER_PRESETS, type ProviderId, type ProviderPreset } from "../core/providers";
import { activeProvider, MODEL_MODE_LABELS, type ModelMode, type ProviderSettings } from "../core/settings";
import type VikalpPlugin from "../main";
import { addModelPicker } from "./modelPicker";

const MODEL_MODES: ModelMode[] = ["lite", "medium", "heavy"];

const SERVER_URL_HELP: Partial<Record<ProviderId, string>> = {
	ollama: "Ollama's usual address. Change it if Ollama runs elsewhere.",
	lmstudio: "LM Studio's usual address. Change it if its server runs elsewhere.",
	custom: "Any OpenAI-compatible server, e.g. https://api.groq.com/openai/v1",
};

/** What to do when the server answers but has no models. */
const NO_MODELS_HELP: Partial<Record<ProviderId, string>> = {
	ollama: "Ollama has no models yet. Run “ollama pull qwen3:8b” in a terminal, then refresh.",
	lmstudio: "LM Studio has no models loaded. Load one in LM Studio, then refresh.",
};

/** What the server said the last time Vikalp asked it for models. */
interface ServerModels {
	/** The URL and key the list was fetched with; a change to either fetches again. */
	source: string;
	status: "loading" | "ready" | "failed";
	ids: string[];
	error: string | null;
	/** The server answered, so typing a model id by hand may still work. */
	answered: boolean;
}

/**
 * The AI rows of Vikalp's settings: provider, key, server URL and models. Rows
 * change with the provider, so the tab rebuilds its definitions after each switch.
 */
export class AiSettingsSection {
	private serverModels: ServerModels | null = null;
	/** Models pi-ai knows for the provider. Null while loading. */
	private catalog: { provider: ProviderId; models: ModelChoice[] | null } | null = null;
	/** Modes where the writer chose "Custom…" and types a model id. */
	private readonly customModes = new Set<ModelMode>();
	private showAdvanced = false;

	constructor(
		private readonly plugin: VikalpPlugin,
		/** Rebuilds the whole settings tab. */
		private readonly rebuild: () => void,
		/** Re-applies `visible` without rebuilding. */
		private readonly refreshVisibility: () => void,
	) {}

	definitions(): SettingDefinition[] {
		const { preset } = activeProvider(this.plugin.settings);
		return [
			{
				name: "Provider",
				desc: "Where AI calls go. Ollama and LM Studio run models on your own machine.",
				aliases: ["openrouter", "anthropic", "openai", "ollama", "lm studio", "local"],
				render: (setting) => {
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions(Object.fromEntries(PROVIDER_IDS.map((id) => [id, PROVIDER_PRESETS[id].label])))
							.setValue(this.plugin.settings.provider)
							.onChange(async (value) => {
								await this.plugin.setProvider(value as ProviderId);
								this.showAdvanced = false;
								this.customModes.clear();
								this.rebuild();
							}),
					);
				},
			},
			...(preset.key === "none" ? [] : [this.keyRow(preset)]),
			...(preset.modes ? this.modeRows(preset) : this.serverRows(preset)),
		];
	}

	private keyRow(preset: ProviderPreset): SettingDefinition {
		const optional = preset.key === "optional";
		const saved = this.plugin.hasApiKey();
		const where = "Kept in Obsidian's secret storage on this device, not in your vault.";
		return {
			name: optional ? "API key" : `${preset.label} API key`,
			desc: optional ? `Only if the server asks for one. ${where}` : `${where} Used only when you click an AI action.`,
			aliases: ["key", "token"],
			render: (setting) => {
				setting.addText((text) => {
					const input = text.inputEl;
					input.type = "password";
					input.autocomplete = "off";
					input.addClass("vk-settings-key");
					text.setPlaceholder(saved ? "Key saved" : preset.keyPlaceholder);
					// The saved key never comes back to the page. Blank keeps it; a new one is saved after a pause, and
					// the row redraws once the writer leaves the field (servers list their models with the key).
					const save = () => {
						pause.cancel();
						const key = input.value.trim();
						if (key) void this.plugin.setApiKey(key);
					};
					const pause = debounce(save, 800, true);
					input.addEventListener("input", pause);
					input.addEventListener("change", () => {
						save();
						this.keyChanged(preset);
					});
				});
				if (saved) {
					setting.addExtraButton((button) =>
						button
							.setIcon("x")
							.setTooltip("Remove the saved key")
							.onClick(async () => {
								await this.plugin.setApiKey("");
								this.keyChanged(preset);
							}),
					);
				}
			},
		};
	}

	private keyChanged(preset: ProviderPreset) {
		if (preset.modes) this.rebuild();
		else this.reloadServerModels();
	}

	/** Providers with Lite, Medium and Heavy. The server URL hides under Advanced since it rarely changes. */
	private modeRows(preset: ProviderPreset): SettingDefinition[] {
		const modes = preset.modes!;
		if (preset.id === "openrouter") {
			void this.plugin.openModels.refresh(this.config().apiKey).then((changed) => {
				if (changed) this.rebuild();
			});
		}
		return [
			{
				name: "Model mode",
				desc: "Which model AI actions use. Lite is fast and cheap, for drafts. Heavy is slower and costs more, for a final pass.",
				control: { type: "dropdown", key: "modelMode", options: Object.fromEntries(MODEL_MODES.map((mode) => [mode, MODEL_MODE_LABELS[mode]])) },
			},
			...MODEL_MODES.map(
				(mode): SettingDefinition => ({
					name: `${MODEL_MODE_LABELS[mode]} model`,
					desc: this.customModes.has(mode) ? `Any ${preset.label} model id. Default: ${modes[mode]}` : `Default: ${this.nameOf(modes[mode])}`,
					render: (setting) => (this.customModes.has(mode) ? this.customModelText(setting, mode, modes[mode]) : this.modelPicker(setting, preset, mode)),
				}),
			),
			{
				name: "Advanced",
				desc: "The server address. Change it only for a regional endpoint or a proxy.",
				render: (setting) => {
					let chevron: ExtraButtonComponent | null = null;
					const toggle = () => {
						this.showAdvanced = !this.showAdvanced;
						chevron?.setIcon(this.showAdvanced ? "chevron-down" : "chevron-right");
						this.refreshVisibility();
					};
					setting.addExtraButton((button) => {
						chevron = button;
						button.setIcon(this.showAdvanced ? "chevron-down" : "chevron-right").onClick(toggle);
					});
					setting.settingEl.addClass("mod-clickable");
					setting.infoEl.onclick = toggle;
				},
			},
			{ ...this.urlRow(preset, "Vikalp talks to any other host as an OpenAI-compatible server. Clear the field to go back to the default."), visible: () => this.showAdvanced },
		];
	}

	/** Ollama, LM Studio and Custom: one model, picked from what the server has. */
	private serverRows(preset: ProviderPreset): SettingDefinition[] {
		return [
			this.urlRow(preset, SERVER_URL_HELP[preset.id] ?? ""),
			{
				name: "Model",
				desc: this.serverModelsStatus(),
				aliases: ["local model"],
				render: (setting) => {
					this.loadServerModels();
					const models = this.serverModels;
					const needsUrl = !activeProvider(this.plugin.settings).baseUrl;
					if (models?.status === "ready" && models.ids.length > 0) {
						const current = this.config().models.lite;
						const ids = current && !models.ids.includes(current) ? [current, ...models.ids] : models.ids;
						setting.addDropdown((dropdown) => {
							if (!current) dropdown.addOption("", "Pick a model");
							dropdown
								.addOptions(Object.fromEntries(ids.map((id) => [id, id])))
								.setValue(current)
								.onChange((value) => void this.setSingleModel(value));
						});
					} else {
						setting.addText((text) =>
							text
								.setPlaceholder(preset.id === "ollama" ? "qwen3:8b" : "model id")
								.setValue(this.config().models.lite)
								.onChange((value) => void this.setSingleModel(value.trim(), false)),
						);
					}
					if (!needsUrl) setting.addExtraButton((button) => button.setIcon("refresh-cw").setTooltip("Ask the server for its models again").onClick(() => this.reloadServerModels()));
				},
			},
		];
	}

	private urlRow(preset: ProviderPreset, desc: string): SettingDefinition {
		return {
			name: "Server URL",
			desc,
			aliases: ["base url", "endpoint", "address"],
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.addClass("vk-settings-url");
					// Shows the preset's URL as a real value, but stores it as empty so a future default still applies.
					text
						.setPlaceholder(preset.baseUrl || "https://…/v1")
						.setValue(this.config().baseUrl || preset.baseUrl)
						.onChange(async (value) => {
							const url = value.trim();
							this.config().baseUrl = url === preset.baseUrl ? "" : url;
							await this.plugin.saveSettings();
						});
					// Act on the new URL once the writer leaves the field, not on every keystroke: list the server's
					// models, or for named providers redraw, since the host may change the protocol and Jev.
					text.inputEl.addEventListener("change", () => (preset.modes ? this.rebuild() : this.reloadServerModels()));
				});
			},
		};
	}

	/** Suggested models for the mode: the newest of each family, the provider's default, and on OpenRouter some open models. */
	private modelPicker(setting: Setting, preset: ProviderPreset, mode: ModelMode) {
		const available = this.catalogModels();
		const fallback = preset.modes![mode];
		const choices = familyChoices(available, mode);
		if (!choices.some((choice) => choice.id === fallback)) choices.push({ id: fallback, name: this.nameOf(fallback) });
		addModelPicker(setting, {
			choices,
			openModels: preset.id === "openrouter" ? (this.plugin.openModels.picks?.[mode] ?? []) : [],
			current: this.config().models[mode],
			onPick: (id) => {
				this.config().models[mode] = id;
				void this.plugin.saveSettings();
			},
			onCustom: () => {
				this.customModes.add(mode);
				this.rebuild();
			},
		});
	}

	private customModelText(setting: Setting, mode: ModelMode, fallback: string) {
		setting.addText((text) =>
			text
				.setPlaceholder(fallback)
				.setValue(this.config().models[mode])
				.onChange(async (value) => {
					this.config().models[mode] = value.trim() || fallback;
					await this.plugin.saveSettings();
				}),
		);
		setting.addExtraButton((button) =>
			button
				.setIcon("list")
				.setTooltip("Pick from the suggested models")
				.onClick(() => {
					this.customModes.delete(mode);
					this.rebuild();
				}),
		);
	}

	/** The catalog's models for the current provider. Empty until loaded; loading rebuilds the tab once. */
	private catalogModels(): ModelChoice[] {
		const provider = this.plugin.settings.provider;
		if (this.catalog?.provider !== provider) {
			const catalog: { provider: ProviderId; models: ModelChoice[] | null } = { provider, models: null };
			this.catalog = catalog;
			void this.plugin.ai
				.listModels()
				.then((models) => {
					catalog.models = models;
					if (this.catalog === catalog) this.rebuild();
				})
				.catch(() => (catalog.models = []));
		}
		return this.catalog?.models ?? [];
	}

	private nameOf(id: string): string {
		return this.catalog?.models?.find((model) => model.id === id)?.name ?? id;
	}

	private serverModelsStatus(): string {
		const preset = activeProvider(this.plugin.settings).preset;
		const models = this.serverModels;
		if (!activeProvider(this.plugin.settings).baseUrl) return "Type the server's URL first.";
		if (!models || models.status === "loading") return "Looking for models on the server…";
		if (models.status === "failed") return models.answered ? `${models.error} You can still type a model id.` : (models.error ?? "");
		if (models.ids.length === 0) return NO_MODELS_HELP[preset.id] ?? "The server lists no models. Type a model id.";
		return `Connected. ${models.ids.length} ${models.ids.length === 1 ? "model" : "models"} on the server.`;
	}

	private modelsSource(): string {
		const { baseUrl, apiKey } = activeProvider(this.plugin.settings);
		return `${this.plugin.settings.provider}\n${baseUrl}\n${apiKey}`;
	}

	private loadServerModels() {
		if (!activeProvider(this.plugin.settings).baseUrl) return;
		const source = this.modelsSource();
		if (this.serverModels?.source === source) return;
		const models: ServerModels = { source, status: "loading", ids: [], error: null, answered: false };
		this.serverModels = models;
		const current = () => this.serverModels === models && this.modelsSource() === source;
		void this.plugin.ai
			.listModels(AbortSignal.timeout(10_000))
			.then(async (choices) => {
				const ids = choices.map((choice) => choice.id);
				Object.assign(models, { status: "ready", ids, answered: true });
				// Embedding models can't chat, and servers often list them first.
				const firstChatModel = ids.find((id) => !/embed/i.test(id));
				if (current() && !this.config().models.lite && firstChatModel) await this.setSingleModel(firstChatModel, false);
			})
			.catch((error: unknown) =>
				Object.assign(models, { status: "failed", error: error instanceof Error ? error.message : String(error), answered: !(error instanceof AiError && error.unreachable) }),
			)
			// If the writer has since changed the URL or key, the next render fetches again; don't redraw under their typing.
			.finally(() => {
				if (current()) this.rebuild();
			});
	}

	private reloadServerModels() {
		this.serverModels = null;
		this.rebuild();
	}

	private async setSingleModel(id: string, rebuild = true) {
		const config = this.config();
		config.models = { lite: id, medium: id, heavy: id };
		await this.plugin.saveSettings();
		if (rebuild) this.rebuild();
	}

	private config(): ProviderSettings {
		return this.plugin.settings.providers[this.plugin.settings.provider];
	}
}
