import { createStore } from "zustand/vanilla";
import type { LintScope, OverflowBlock, Severity, SpanUnit, Version } from "../core/model/types";
import { MODEL_MODE_LABELS, type ModelMode } from "../core/settings";

export interface SpanView {
	id: string;
	unit: SpanUnit;
	versions: Version[];
	activeVersion: string;
	note: string;
	/** The text in the document right now, or null when the span is not placed. */
	text: string | null;
	hidden: boolean;
	orphaned: boolean;
	lastText: string | null;
	/** Text around the span in its sentence, for the panel's context line. Empty for paragraphs. */
	before: string;
	after: string;
}

export interface LintHitView {
	id: string;
	ruleId: string;
	label: string;
	message: string;
	severity: Severity;
	scope: LintScope;
	source: "rule" | "lab";
	/** True when a model (Jev or an LLM) made this hit, so it carries an AI label. */
	byAi: boolean;
	excerpt: string;
	from: number;
	suggestion?: string;
	model?: string;
}

export interface NoteView {
	path: string;
	title: string;
	loaded: boolean;
	markersOn: boolean;
	readThrough: boolean;
	words: number;
	selectedWords: number;
	ghostWords: number;
	ghostCount: number;
	spans: SpanView[];
	/** The span at the text cursor, if any. */
	cursorSpanId: string | null;
	overflow: OverflowBlock[];
	lintHits: LintHitView[];
	proposalCount: number;
	proposalWords: number;
	/** Why the model proposed the cut the walk-through is on. */
	walkReason: string | null;
	/** Proposed cuts a grammar check flagged as possibly breaking a sentence. */
	riskyCount: number;
}

export type { TrimLevelId as TrimLevel } from "../core/ai/passes";
import type { TrimLevelId } from "../core/ai/passes";

export interface TrimState {
	level: TrimLevelId;
	status: "idle" | "reading" | "ready" | "error";
	beforeWords: number;
	message: string | null;
	rejected: number;
	walking: boolean;
	notePath: string | null;
}

export interface LintRunState {
	running: boolean;
	ranAt: number | null;
	judgmentTotal: number;
	judgmentDone: number;
	notice: string | null;
	ruleErrors: string[];
	notePath: string | null;
	/** AI cost of the last run. */
	cost: number;
}

export interface LabPassState {
	runningPass: string | null;
	message: string | null;
}

export interface CostEntry {
	id: string;
	at: number;
	purpose: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cost: number;
	/** Whether `cost` is a real price, zero because the model is local, or zero because the price is unknown. */
	pricing: "priced" | "free" | "unpriced";
	fallback?: boolean;
	error?: string;
}

/** Where AI calls go: a provider with Lite, Medium and Heavy, or one model the writer picked. */
export interface AiModelState {
	hasModes: boolean;
	/** The model the current mode uses. */
	modelId: string;
	/** True when the model runs on this computer, so calls cost nothing. */
	free: boolean;
}

export interface VikalpUiState {
	note: NoteView | null;
	/** The span the Alternatives panel shows. */
	panelSpanId: string | null;
	panelFocused: boolean;
	/** Spans waiting on AI alternatives. */
	aiPendingSpans: string[];
	lint: LintRunState;
	trim: TrimState;
	lab: LabPassState;
	costs: CostEntry[];
	modelMode: ModelMode;
	aiModel: AiModelState;
	/** Why AI can't run yet, as the start of a sentence. Null once it can. */
	aiSetupHint: string | null;
	/** The lint mark the writer last clicked in the text; the Lint panel scrolls to it. */
	lintFocus: { hitId: string; at: number } | null;
	lintLayout: LintLayout;
	/** Alternatives whose note field the writer just asked to open. */
	noteEditorSpanId: string | null;
	keyHints: KeyHints;
}

/** The hotkey each main command has right now, as Obsidian prints it, or null when it has none. */
export interface KeyHints {
	alternatives: string | null;
	askAi: string | null;
	actions: string | null;
}

/** How the Lint panel lists marks: grouped by rule, or in the order they appear. */
export type LintLayout = "by-rule" | "in-order";

export const initialUiState: VikalpUiState = {
	note: null,
	panelSpanId: null,
	panelFocused: false,
	aiPendingSpans: [],
	lint: { running: false, ranAt: null, judgmentTotal: 0, judgmentDone: 0, notice: null, ruleErrors: [], notePath: null, cost: 0 },
	trim: { level: "original", status: "idle", beforeWords: 0, message: null, rejected: 0, walking: false, notePath: null },
	lab: { runningPass: null, message: null },
	costs: [],
	modelMode: "lite",
	aiModel: { hasModes: true, modelId: "", free: false },
	aiSetupHint: null,
	lintFocus: null,
	lintLayout: "by-rule",
	noteEditorSpanId: null,
	keyHints: { alternatives: null, askAi: null, actions: null },
};

export function createUiStore() {
	return createStore<VikalpUiState>()(() => initialUiState);
}

export type UiStore = ReturnType<typeof createUiStore>;

export function sessionCost(state: VikalpUiState): number {
	return state.costs.reduce((sum, entry) => sum + entry.cost, 0);
}

/** What to call the model in the UI: the mode ("Lite") for providers with modes, the model id otherwise. */
export function modelLabel(state: VikalpUiState): string {
	return state.aiModel.hasModes ? MODEL_MODE_LABELS[state.modelMode] : state.aiModel.modelId;
}

/** What this session's AI calls cost, as the Lab shows it: a price, "Free" on a local model, or tokens when the price is unknown. */
export type SessionCost = { kind: "price"; dollars: number } | { kind: "free" } | { kind: "tokens"; tokens: number };

export function sessionCostSummary(state: VikalpUiState): SessionCost {
	if (state.costs.some((entry) => entry.pricing === "unpriced")) {
		return { kind: "tokens", tokens: state.costs.reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0) };
	}
	const dollars = sessionCost(state);
	if (dollars === 0 && state.aiModel.free) return { kind: "free" };
	return { kind: "price", dollars };
}
