import { PROVIDER_IDS, PROVIDER_PRESETS, type ProviderId, type ProviderPreset } from "./providers";

export type ModelMode = "lite" | "medium" | "heavy";
export type JudgmentEngineChoice = "jev" | "llm";
export type TrimPrimaryAction = "ghost" | "cut";

/** What the writer set for one provider. Kept per provider so switching back loses nothing. */
export interface ProviderSettings {
	apiKey: string;
	/** Empty uses the preset's URL. */
	baseUrl: string;
	/** For providers without modes, all three hold the one model. */
	models: Record<ModelMode, string>;
}

export interface VikalpSettings {
	provider: ProviderId;
	providers: Record<ProviderId, ProviderSettings>;
	jevModel: string;
	modelMode: ModelMode;
	judgmentEngine: JudgmentEngineChoice;
	/** Rule ids switched off by the user. Everything else runs. */
	disabledRules: string[];
	rulesFolder: string;
	liveLocalLint: boolean;
	articleFix: boolean;
	hoverCycling: boolean;
	trimPrimaryAction: TrimPrimaryAction;
	voiceReferenceNotes: string[];
	markersOnByDefault: boolean;
	alternativesCount: number;
	lintLayout: "by-rule" | "in-order";
	/** Gives the main commands Vikalp's suggested hotkeys. Off so Vikalp never takes keys unasked. */
	suggestedHotkeys: boolean;
}

export const DEFAULT_SETTINGS: VikalpSettings = {
	provider: "openrouter",
	providers: Object.fromEntries(PROVIDER_IDS.map((id) => [id, defaultProviderSettings(id)])) as Record<ProviderId, ProviderSettings>,
	jevModel: "typesafe/jev-1.13",
	modelMode: "lite",
	judgmentEngine: "jev",
	disabledRules: [],
	rulesFolder: "rules",
	liveLocalLint: false,
	articleFix: true,
	hoverCycling: true,
	trimPrimaryAction: "ghost",
	voiceReferenceNotes: [],
	markersOnByDefault: false,
	alternativesCount: 5,
	lintLayout: "by-rule",
	suggestedHotkeys: false,
};

export const MODEL_MODE_LABELS: Record<ModelMode, string> = { lite: "Lite", medium: "Medium", heavy: "Heavy" };

/** Settings saved before providers existed had one OpenRouter key and model set at the top level. */
interface LegacySettings {
	openRouterApiKey?: string;
	models?: Partial<Record<ModelMode, string>>;
}

export function mergeSettings(saved: (Partial<VikalpSettings> & LegacySettings) | null | undefined): VikalpSettings {
	const { openRouterApiKey, models: legacyModels, providers: savedProviders, ...rest } = saved ?? {};
	const providers = Object.fromEntries(
		PROVIDER_IDS.map((id) => {
			const defaults = defaultProviderSettings(id);
			const stored: Partial<ProviderSettings> = savedProviders?.[id] ?? (id === "openrouter" ? { apiKey: openRouterApiKey, models: legacyModels as Record<ModelMode, string> } : {});
			return [id, { apiKey: stored.apiKey ?? "", baseUrl: stored.baseUrl ?? "", models: { ...defaults.models, ...(stored.models ?? {}) } }];
		}),
	) as Record<ProviderId, ProviderSettings>;
	const provider = rest.provider && rest.provider in PROVIDER_PRESETS ? rest.provider : DEFAULT_SETTINGS.provider;
	return { ...DEFAULT_SETTINGS, ...rest, provider, providers };
}

/** The provider in use, with its URL and key resolved. */
export interface ActiveProvider {
	preset: ProviderPreset;
	baseUrl: string;
	apiKey: string;
	models: Record<ModelMode, string>;
}

export function activeProvider(settings: VikalpSettings): ActiveProvider {
	const preset = PROVIDER_PRESETS[settings.provider];
	const config = settings.providers[settings.provider];
	return { preset, baseUrl: config.baseUrl.trim() || preset.baseUrl, apiKey: config.apiKey.trim(), models: config.models };
}

/** The model a request in `mode` goes to. Providers without modes always use their one model. */
export function modelFor(settings: VikalpSettings, mode: ModelMode): string {
	return activeProvider(settings).models[mode].trim();
}

function defaultProviderSettings(id: ProviderId): ProviderSettings {
	const modes = PROVIDER_PRESETS[id].modes;
	return { apiKey: "", baseUrl: "", models: modes ? { ...modes } : { lite: "", medium: "", heavy: "" } };
}
