import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { SpanUnit } from "../core/model/types";
import type { ModelMode } from "../core/settings";
import type { TrimLevel, UiStore } from "../store/uiStore";

export interface AlternativesActions {
	selectVersion: (spanId: string, versionId: string) => void;
	/** Shows the version `step` places away from the current one, wrapping around. */
	stepVersion: (spanId: string, step: number) => void;
	addVersion: (spanId: string, text: string) => void;
	deleteVersion: (spanId: string, versionId: string) => void;
	askAi: (spanId: string) => void;
	createForUnit: (unit: SpanUnit) => void;
	setNote: (spanId: string, note: string) => void;
	placeOrphan: (spanId: string) => void;
	deleteSpan: (spanId: string) => void;
	settleSpan: (spanId: string) => void;
	jumpToSpan: (spanId: string) => void;
	removeAiVersions: (spanId: string) => void;
	focusEditor: () => void;
	/** Opens the ⋯ menu for these alternatives next to `anchor`. */
	openMenu: (spanId: string, anchor: HTMLElement) => void;
	setPanelFocused: (focused: boolean) => void;
}

export interface OverflowActions {
	addBlock: (text: string) => void;
	updateBlock: (blockId: string, text: string) => void;
	deleteBlock: (blockId: string) => void;
	moveBlock: (blockId: string, index: number) => void;
	insertAtCursor: (blockId: string, keepCopy: boolean) => void;
	promoteToAlternative: (blockId: string) => void;
	copyBlock: (blockId: string) => void;
}

export interface LintActions {
	run: () => void;
	clear: () => void;
	jumpTo: (hitId: string) => void;
	ignore: (hitId: string) => void;
	applyFix: (hitId: string) => void;
	applyAllFixes: () => void;
	openRulesFolder: () => void;
	setLayout: (layout: "by-rule" | "in-order") => void;
	reloadRules: () => void;
}

export interface LabActions {
	setModelMode: (mode: ModelMode) => void;
	runPass: (passId: string) => void;
	/** AI picks the words worth trying alternatives for and adds versions to each. */
	findSpots: () => void;
	removeAllAiVersions: () => void;
	setTrimLevel: (level: TrimLevel) => void;
	ghostCuts: () => void;
	makeCuts: () => void;
	walkThrough: () => void;
	walkStep: (decision: "keep" | "cut" | "skip") => void;
	stopWalking: () => void;
	finishTrim: () => void;
	clearMarks: () => void;
	openSettings: () => void;
	showCostLog: () => void;
	/** The Lab's ⋯ menu: clearing marks, removing AI versions, settings. */
	openMenu: (anchor: HTMLElement, markCount: number) => void;
	close: () => void;
}

export interface VikalpViewContext {
	store: UiStore;
	alternatives: AlternativesActions;
	overflow: OverflowActions;
	lint: LintActions;
	lab: LabActions;
	trimPrimary: () => "ghost" | "cut";
}

export const ViewContext = createContext<VikalpViewContext | null>(null);

export function useViewContext(): VikalpViewContext {
	const context = useContext(ViewContext);
	if (!context) throw new Error("Vikalp view rendered outside its provider");
	return context;
}
