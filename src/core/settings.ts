export type ModelMode = "lite" | "medium" | "heavy";
export type JudgmentEngineChoice = "jev" | "llm";
export type TrimPrimaryAction = "ghost" | "cut";

export interface VikalpSettings {
	openRouterApiKey: string;
	models: Record<ModelMode, string>;
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
	openRouterApiKey: "",
	models: {
		lite: "openai/gpt-6-luna",
		medium: "anthropic/claude-sonnet-5.5",
		heavy: "anthropic/claude-opus-5.5",
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
	suggestedHotkeys: false,
};

export const MODEL_MODE_LABELS: Record<ModelMode, string> = { lite: "Lite", medium: "Medium", heavy: "Heavy" };

export function mergeSettings(saved: Partial<VikalpSettings> | null | undefined): VikalpSettings {
	return {
		...DEFAULT_SETTINGS,
		...(saved ?? {}),
		models: { ...DEFAULT_SETTINGS.models, ...(saved?.models ?? {}) },
	};
}
