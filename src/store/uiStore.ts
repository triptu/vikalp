import { createStore } from "zustand/vanilla";
import type { LintScope, OverflowBlock, Severity, SpanUnit, Version } from "../core/model/types";
import type { ModelMode } from "../core/settings";

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
	fallback?: boolean;
	error?: string;
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
	hasApiKey: boolean;
}

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
	hasApiKey: false,
};

export function createUiStore() {
	return createStore<VikalpUiState>()(() => initialUiState);
}

export type UiStore = ReturnType<typeof createUiStore>;

export function sessionCost(state: VikalpUiState): number {
	return state.costs.reduce((sum, entry) => sum + entry.cost, 0);
}
