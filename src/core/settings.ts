export type ModelMode = "lite" | "medium" | "heavy";
export type AiProvider = "openrouter" | "chatgpt";
export type JudgmentEngineChoice = "jev" | "llm";
export type TrimPrimaryAction = "ghost" | "cut";

export interface VikalpSettings {
	aiProvider: AiProvider;
	openRouterApiKey: string;
	/** OpenRouter model ids per mode. */
	models: Record<ModelMode, string>;
	/** OpenAI model ids per mode, used when signed in with ChatGPT. */
	chatgptModels: Record<ModelMode, string>;
	/** The ChatGPT sign-in as pi-ai stores it (tokens). Null when signed out. */
	chatgptCredential: Record<string, unknown> | null;
	/** Identifies this install to OpenAI during sign-in. Made on first use. */
	chatgptDeviceId: string;
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
}

export const DEFAULT_SETTINGS: VikalpSettings = {
	aiProvider: "openrouter",
	openRouterApiKey: "",
	chatgptCredential: null,
	chatgptDeviceId: "",
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
};

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = { openrouter: "OpenRouter", chatgpt: "ChatGPT" };

export const MODEL_MODE_LABELS: Record<ModelMode, string> = { lite: "Lite", medium: "Medium", heavy: "Heavy" };

export function mergeSettings(saved: Partial<VikalpSettings> | null | undefined): VikalpSettings {
	return {
		...DEFAULT_SETTINGS,
		...(saved ?? {}),
		models: { ...DEFAULT_SETTINGS.models, ...(saved?.models ?? {}) },
		chatgptModels: { ...DEFAULT_SETTINGS.chatgptModels, ...(saved?.chatgptModels ?? {}) },
	};
}
