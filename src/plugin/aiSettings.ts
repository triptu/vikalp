import type { ExtraButtonComponent, Setting, SettingDefinition } from "obsidian";
import { AiError } from "../ai/aiClient";
import { PROVIDER_IDS, PROVIDER_PRESETS, type ProviderId, type ProviderPreset } from "../core/providers";
import { activeProvider, MODEL_MODE_LABELS, type ModelMode, type ProviderSettings } from "../core/settings";
import type VikalpPlugin from "../main";

const MODEL_MODES: ModelMode[] = ["lite", "medium", "heavy"];

const SERVER_URL_HELP: Partial<Record<ProviderId, string>> = {
	ollama: "Ollama's usual address. Change it if Ollama runs elsewhere.",
	lmstudio: "Start the server in LM Studio's Developer tab and turn on CORS there.",
	custom: "Any OpenAI-compatible server, e.g. https://api.groq.com/openai/v1",
};

/** What the server said the last time Vikalp asked it for models. */
interface ServerModels {
	/** The URL and key the list was fetched with; a change to either fetches again. */
	source: string;
	status: "loading" | "ready" | "failed";
	ids: string[];
	error: string | null;
}

/**
 * The AI rows of Vikalp's settings: provider, key, server URL and models. Rows
 * change with the provider, so the tab rebuilds its definitions after each switch.
 */
export class AiSettingsSection {
	private serverModels: ServerModels | null = null;
	/** Model ids pi-ai knows for the provider. Null ids while loading. */
	private catalog: { provider: ProviderId; ids: string[] | null } | null = null;
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
				desc: "Where AI calls go. Ollama and LM Studio run models on this computer, so nothing leaves it.",
				aliases: ["openrouter", "anthropic", "openai", "ollama", "lm studio", "local"],
				render: (setting) => {
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions(Object.fromEntries(PROVIDER_IDS.map((id) => [id, PROVIDER_PRESETS[id].label])))
							.setValue(this.plugin.settings.provider)
							.onChange(async (value) => {
								await this.plugin.setProvider(value as ProviderId);
								this.showAdvanced = false;
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
		return {
			name: optional ? "API key" : `${preset.label} API key`,
			desc: optional ? "Only if the server asks for one. Kept in plugin data, not in your notes." : "Kept in plugin data, not in your notes. Used only when you click an AI action.",
			aliases: ["key", "token"],
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.type = "password";
					text.inputEl.addClass("vk-settings-key");
					text
						.setPlaceholder(preset.keyPlaceholder)
						.setValue(this.config().apiKey)
						.onChange(async (value) => {
							this.config().apiKey = value.trim();
							await this.plugin.saveSettings();
						});
					// Servers list their models with the key, so ask again once it's typed.
					if (!preset.modes) text.inputEl.addEventListener("change", () => this.reloadServerModels());
				});
			},
		};
	}

	/** Providers with Lite, Medium and Heavy. The server URL hides under Advanced since it rarely changes. */
	private modeRows(preset: ProviderPreset): SettingDefinition[] {
		const modes = preset.modes!;
		return [
			{
				name: "Model mode",
				desc: "Applies to every AI action. Lite is fast and cheap for drafting; Heavy is for the final pass.",
				control: { type: "dropdown", key: "modelMode", options: Object.fromEntries(MODEL_MODES.map((mode) => [mode, MODEL_MODE_LABELS[mode]])) },
			},
			...MODEL_MODES.map(
				(mode): SettingDefinition => ({
					name: `${MODEL_MODE_LABELS[mode]} model`,
					desc: `${preset.label} model id. Default: ${modes[mode]}`,
					render: (setting) => (preset.id === "openrouter" ? this.modelText(setting, mode, modes[mode]) : this.catalogDropdown(setting, mode, modes[mode])),
				}),
			),
			{
				name: "Advanced",
				desc: "The server address, for a proxy or a regional endpoint.",
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
			{ ...this.urlRow(preset, `Default: ${preset.baseUrl}`), visible: () => this.showAdvanced },
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
					setting.addExtraButton((button) => button.setIcon("refresh-cw").setTooltip("Ask the server for its models again").onClick(() => this.reloadServerModels()));
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
					text
						.setPlaceholder(preset.baseUrl || "https://…/v1")
						.setValue(this.config().baseUrl)
						.onChange(async (value) => {
							this.config().baseUrl = value.trim();
							await this.plugin.saveSettings();
						});
					// Fetch the model list once the writer leaves the field, not on every keystroke.
					if (!preset.modes) text.inputEl.addEventListener("change", () => this.reloadServerModels());
				});
			},
		};
	}

	private modelText(setting: Setting, mode: ModelMode, fallback: string) {
		setting.addText((text) =>
			text
				.setPlaceholder(fallback)
				.setValue(this.config().models[mode])
				.onChange(async (value) => {
					this.config().models[mode] = value.trim() || fallback;
					await this.plugin.saveSettings();
				}),
		);
	}

	private catalogDropdown(setting: Setting, mode: ModelMode, fallback: string) {
		const provider = this.plugin.settings.provider;
		if (this.catalog?.provider !== provider) {
			const catalog: { provider: ProviderId; ids: string[] | null } = { provider, ids: null };
			this.catalog = catalog;
			void this.plugin.ai.listModels().then((ids) => {
				catalog.ids = ids;
				if (this.catalog === catalog) this.rebuild();
			});
		}
		const known = this.catalog?.ids;
		if (!known) return this.modelText(setting, mode, fallback);
		const current = this.config().models[mode];
		const ids = known.includes(current) ? known : [current, ...known];
		setting.addDropdown((dropdown) =>
			dropdown
				.addOptions(Object.fromEntries(ids.map((id) => [id, id])))
				.setValue(current)
				.onChange(async (value) => {
					this.config().models[mode] = value;
					await this.plugin.saveSettings();
				}),
		);
	}

	private serverModelsStatus(): string {
		const models = this.serverModels;
		if (!models || models.status === "loading") return "Looking for models on the server…";
		if (models.status === "failed") return `${models.error} You can also type a model id.`;
		if (models.ids.length === 0) return "The server has no models yet. Download one, then refresh.";
		return `Connected. ${models.ids.length} ${models.ids.length === 1 ? "model" : "models"} on the server.`;
	}

	private loadServerModels() {
		const { baseUrl, apiKey } = activeProvider(this.plugin.settings);
		const source = `${baseUrl}\n${apiKey}`;
		if (this.serverModels?.source === source) return;
		const models: ServerModels = { source, status: "loading", ids: [], error: null };
		this.serverModels = models;
		void this.plugin.ai
			.listModels()
			.then(async (ids) => {
				Object.assign(models, { status: "ready", ids });
				if (!this.config().models.lite && ids[0]) await this.setSingleModel(ids[0], false);
			})
			.catch((error: unknown) => Object.assign(models, { status: "failed", error: error instanceof AiError ? error.message : String(error) }))
			.finally(() => {
				if (this.serverModels === models) this.rebuild();
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
