import { Facet } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";

export interface EditorSettings {
	articleFix: boolean;
	hoverCycling: boolean;
}

/**
 * What the editor layer needs from the plugin. Keeps CodeMirror code free of
 * Obsidian imports: the plugin provides one host for every editor.
 */
export interface VikalpHost {
	settings(): EditorSettings;
	editorCreated(view: EditorView): void;
	editorUpdated(update: ViewUpdate): void;
	editorDestroyed(view: EditorView): void;
	applyLintFix(view: EditorView, hitId: string): void;
	ignoreLintHit(view: EditorView, hitId: string): void;
	vetoProposal(view: EditorView, proposalId: string): void;
	dropOverflowBlock(view: EditorView, blockId: string, position: number, keepCopy: boolean): void;
	notify(message: string): void;
}

export const vikalpHost = Facet.define<VikalpHost, VikalpHost | null>({
	combine: (hosts) => hosts[0] ?? null,
});

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = { articleFix: true, hoverCycling: true };

export { OVERFLOW_DRAG_TYPE } from "../core/constants";
