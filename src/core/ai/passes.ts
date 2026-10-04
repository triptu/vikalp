export type LabPassId = "typos" | "weakest" | "long" | "convoluted" | "tone" | "hedges";

export interface LabPass {
	id: LabPassId;
	label: string;
	/** Short label used on marks and in the Lint panel. */
	markLabel: string;
	description: string;
}

export const LAB_PASSES: LabPass[] = [
	{
		id: "typos",
		label: "Fix punctuation and typos",
		markLabel: "Typo",
		description: "Spelling, punctuation and agreement only. Each fix can be applied or ignored.",
	},
	{
		id: "weakest",
		label: "Mark the weakest sentences",
		markLabel: "Weak sentence",
		description: "Up to five sentences that pull the piece down, each with a reason.",
	},
	{
		id: "long",
		label: "Mark sentences that run long",
		markLabel: "Runs long",
		description: "Long sentences where the length actually hurts.",
	},
	{
		id: "convoluted",
		label: "Mark convoluted sentences",
		markLabel: "Convoluted",
		description: "Structure a reader has to untangle.",
	},
	{
		id: "tone",
		label: "Mark words that don't fit the tone",
		markLabel: "Off tone",
		description: "Words that clash with the rest of the note, or with your voice references.",
	},
	{
		id: "hedges",
		label: "Mark hedges and filler",
		markLabel: "Hedge or filler",
		description: "Softeners and filler words, including ones word lists miss.",
	},
];

export type TrimLevelId = "original" | "slight" | "tighten" | "sharper" | "half";

export interface TrimLevel {
	id: TrimLevelId;
	label: string;
	short: string;
	/** Share of words to cut. */
	target: number;
}

export const TRIM_LEVELS: TrimLevel[] = [
	{ id: "original", label: "Original", short: "Original", target: 0 },
	{ id: "slight", label: "Slight trim", short: "Slight ~10%", target: 0.1 },
	{ id: "tighten", label: "Tighten more", short: "Tighten ~20%", target: 0.2 },
	{ id: "sharper", label: "Even sharper", short: "Sharper ~30%", target: 0.3 },
	{ id: "half", label: "Cut in half", short: "Half ~50%", target: 0.5 },
];

export function trimLevel(id: TrimLevelId): TrimLevel {
	return TRIM_LEVELS.find((level) => level.id === id) ?? TRIM_LEVELS[0]!;
}
