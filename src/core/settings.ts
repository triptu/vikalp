export type ModelMode = "lite" | "medium" | "heavy";
/** Where AI calls go: OpenRouter with the writer's key, or OpenAI through Sign in with ChatGPT. */
export type AiProvider = "openrouter" | "chatgpt";
export type JudgmentEngineChoice = "jev" | "llm";
export type TrimPrimaryAction = "ghost" | "cut";

/** A sign-in token as pi-ai stores it. pi-ai refreshes it; Vikalp only saves it. */
export interface OAuthToken {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
	[key: string]: unknown;
}

export interface VikalpSettings {
	aiProvider: AiProvider;
	openRouterApiKey: string;
	models: Record<ModelMode, string>;
	chatgptModels: Record<ModelMode, string>;
	/** Null when signed out of ChatGPT. */
	chatgptToken: OAuthToken | null;
	/** Identifies this install to OpenAI when signing in with ChatGPT. Created on first sign-in. */
	deviceId: string;
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
	aiProvider: "openrouter",
	openRouterApiKey: "",
	models: {
		lite: "openai/gpt-6-luna",
		medium: "anthropic/claude-sonnet-5.5",
		heavy: "anthropic/claude-opus-5.5",
	},
	chatgptModels: {
		lite: "gpt-6-luna",
		medium: "gpt-6.1-sol",
		heavy: "gpt-6-astra",
	},
	chatgptToken: null,
	deviceId: "",
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

export function mergeSettings(saved: Partial<VikalpSettings> | null | undefined): VikalpSettings {
	return {
		...DEFAULT_SETTINGS,
		...(saved ?? {}),
		models: { ...DEFAULT_SETTINGS.models, ...(saved?.models ?? {}) },
		chatgptModels: { ...DEFAULT_SETTINGS.chatgptModels, ...(saved?.chatgptModels ?? {}) },
	};
}
