import { PROVIDER_IDS, PROVIDER_PRESETS, withScheme, type ProviderId, type ProviderPreset } from "./providers";

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

/** What data.json holds: the settings with each provider's key left out once secret storage has it. */
export type SavedSettings = Omit<VikalpSettings, "providers"> & { providers: Partial<Record<ProviderId, Partial<ProviderSettings>>> };

/** Where API keys live outside data.json. Backed by Obsidian's secret storage in the plugin. */
export interface ApiKeyStore {
	read(provider: ProviderId): string | null;
	write(provider: ProviderId, key: string): void;
}

export function mergeSettings(saved: (Partial<SavedSettings> & LegacySettings) | null | undefined): VikalpSettings {
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

/**
 * The settings for a session: data.json plus the keys the store holds. A key still in
 * data.json wins and comes back as `moved`, the file to write once the store has it.
 */
export function loadSettings(saved: (Partial<SavedSettings> & LegacySettings) | null | undefined, store: ApiKeyStore | null): { settings: VikalpSettings; moved: SavedSettings | null } {
	const settings = mergeSettings(saved);
	if (!store) return { settings, moved: null };
	for (const id of PROVIDER_IDS) {
		const config = settings.providers[id];
		if (!config.apiKey) config.apiKey = store.read(id) ?? "";
	}
	const plaintext = PROVIDER_IDS.some((id) => Boolean(saved?.providers?.[id]?.apiKey)) || Boolean(saved?.openRouterApiKey);
	return { settings, moved: plaintext ? stashApiKeys(settings, store) : null };
}

/**
 * What to write to data.json. Each key goes to the store and leaves the file only once the
 * store reads it back; a key the store won't take, or every key without a store, stays in the file.
 */
export function stashApiKeys(settings: VikalpSettings, store: ApiKeyStore | null): SavedSettings {
	const providers = Object.fromEntries(
		PROVIDER_IDS.map((id) => {
			const { apiKey, ...rest } = settings.providers[id];
			const stored = store ? storeHolds(store, id, apiKey) : false;
			return [id, stored || !apiKey ? rest : { ...rest, apiKey }];
		}),
	) as SavedSettings["providers"];
	return { ...settings, providers };
}

function storeHolds(store: ApiKeyStore, id: ProviderId, key: string): boolean {
	const held = () => (store.read(id) ?? "") === key;
	if (held()) return true;
	try {
		store.write(id, key);
	} catch {
		return false;
	}
	return held();
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
	return { preset, baseUrl: withScheme(config.baseUrl) || preset.baseUrl, apiKey: config.apiKey.trim(), models: config.models };
}

/** The model a request in `mode` goes to. Providers without modes always use their one model. */
export function modelFor(settings: VikalpSettings, mode: ModelMode): string {
	return activeProvider(settings).models[mode].trim();
}

function defaultProviderSettings(id: ProviderId): ProviderSettings {
	const modes = PROVIDER_PRESETS[id].modes;
	return { apiKey: "", baseUrl: "", models: modes ? { ...modes } : { lite: "", medium: "", heavy: "" } };
}
