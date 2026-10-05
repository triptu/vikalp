import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Notice } from "obsidian";
import { newId } from "../core/model/ids";
import type { SpanUnit } from "../core/model/types";
import {
	addVersionToSpan,
	createSpanFromSelection,
	cycleSpan,
	deleteVersionFromSpan,
	insertOverflowBlock,
	placeSpanOnSelection,
	removeAiVersions,
	setNoteOnSpan,
	settleSpans,
	switchToVersion,
} from "../editor/actions";
import { runAction } from "../editor/interaction";
import { addOverflowBlock, moveOverflowBlock, noteModeField, overflowField, removeOverflowBlock, setNoteMode, updateOverflowBlock } from "../editor/noteFields";
import { removeSpan, spanMeta, spanRange } from "../editor/spansField";
import { VIKALP_EVENT, isolated, noHistory } from "../editor/transactions";
import type { AlternativesActions, OverflowActions } from "../views/context";
import type { AiAlternatives } from "./aiAlternatives";
import type { NoteController } from "./noteController";
import type { Panels } from "./panels";

export interface AlternativesDeps {
	controller: NoteController;
	panels: Panels;
	ai: AiAlternatives;
	articleFix: () => boolean;
	panelSpanId: () => string | null;
}

function withEditor<Args extends unknown[]>(controller: NoteController, run: (view: EditorView, ...args: Args) => void) {
	return (...args: Args) => {
		const view = controller.editor;
		if (!view) {
			new Notice("Open a note first.");
			return;
		}
		run(view, ...args);
	};
}

export function ensureMarkersOn(view: EditorView) {
	if (!view.state.field(noteModeField).markersOn) view.dispatch({ effects: setNoteMode.of({ markersOn: true }) });
}

/** Opens the panel on a span (creating it from the selection if needed) and focuses its input. */
export function startAlternatives(deps: AlternativesDeps, view: EditorView, unit?: SpanUnit, options: { askAi?: boolean } = {}) {
	const panelSpanId = deps.panelSpanId();
	const panelSpan = panelSpanId && spanRange(view.state, panelSpanId) ? panelSpanId : null;
	const selection = view.state.selection.main;
	const base = unit && panelSpan && selection.empty ? spanRange(view.state, panelSpan)! : { from: selection.from, to: selection.to };
	const result = createSpanFromSelection(view.state, base, unit);
	if (!result.ok) {
		new Notice(result.message);
		return;
	}
	if (result.created) runAction(view, result);
	ensureMarkersOn(view);
	deps.controller.setPanelSpan(result.spanId);
	deps.controller.publishNow();
	if (options.askAi) {
		void deps.panels.open("vikalp-alternatives", "left");
		const title = (deps.controller.activePath ?? "").replace(/^.*\//, "").replace(/\.md$/, "");
		void deps.ai.request(view, result.spanId, title);
	} else {
		void deps.panels.focusAlternativesInput();
	}
}

export function createAlternativesActions(deps: AlternativesDeps): AlternativesActions {
	const { controller } = deps;
	const switchOptions = () => ({ articleFix: deps.articleFix() });
	return {
		selectVersion: withEditor(controller, (view, spanId: string, versionId: string) => {
			const version = spanMeta(view.state, spanId)?.versions.find((candidate) => candidate.id === versionId);
			if (!version || spanMeta(view.state, spanId)?.activeVersion === versionId) return;
			runAction(view, switchToVersion(view.state, spanId, version, switchOptions()));
		}),
		stepVersion: withEditor(controller, (view, spanId: string, step: number) => {
			if ((spanMeta(view.state, spanId)?.versions.length ?? 0) < 2) return;
			runAction(view, cycleSpan(view.state, spanId, step, switchOptions()));
		}),
		addVersion: withEditor(controller, (view, spanId: string, text: string) => {
			ensureMarkersOn(view);
			runAction(view, addVersionToSpan(view.state, spanId, text, "human", { ...switchOptions(), activate: true }));
		}),
		deleteVersion: withEditor(controller, (view, spanId: string, versionId: string) => {
			runAction(view, deleteVersionFromSpan(view.state, spanId, versionId, { ...switchOptions(), prefer: "previous" }));
		}),
		askAi: withEditor(controller, (view, spanId: string) => {
			ensureMarkersOn(view);
			const title = (controller.activePath ?? "").replace(/^.*\//, "").replace(/\.md$/, "");
			void deps.ai.request(view, spanId, title);
		}),
		createForUnit: withEditor(controller, (view, unit: SpanUnit) => startAlternatives(deps, view, unit)),
		setNote: withEditor(controller, (view, spanId: string, note: string) => {
			runAction(view, setNoteOnSpan(view.state, spanId, note));
		}),
		placeOrphan: withEditor(controller, (view, spanId: string) => {
			const selection = view.state.selection.main;
			if (selection.empty) {
				new Notice("Select the text these versions belong to, then click Place on selection.");
				return;
			}
			if (runAction(view, placeSpanOnSelection(view.state, spanId, { from: selection.from, to: selection.to }))) controller.setPanelSpan(spanId);
		}),
		deleteSpan: withEditor(controller, (view, spanId: string) => {
			view.dispatch(isolated({ effects: removeSpan.of({ id: spanId }), userEvent: VIKALP_EVENT.edit }));
		}),
		settleSpan: withEditor(controller, (view, spanId: string) => {
			runAction(view, settleSpans(view.state, [spanId]));
		}),
		jumpToSpan: withEditor(controller, (view, spanId: string) => {
			const range = spanRange(view.state, spanId);
			if (!range) return;
			view.dispatch({ selection: EditorSelection.range(range.from, range.to), effects: EditorView.scrollIntoView(range.from, { y: "center" }) });
			view.focus();
		}),
		removeAiVersions: withEditor(controller, (view, spanId: string) => {
			runAction(view, removeAiVersions(view.state, spanId, switchOptions()));
		}),
		focusEditor: () => {
			controller.setPanelFocused(false);
			controller.editor?.focus();
		},
		setPanelFocused: (focused: boolean) => controller.setPanelFocused(focused),
	};
}

export function createOverflowActions(deps: AlternativesDeps): OverflowActions {
	const { controller } = deps;
	const blockText = (view: EditorView, blockId: string) => view.state.field(overflowField).find((block) => block.id === blockId)?.text;
	return {
		addBlock: withEditor(controller, (view, text: string) => {
			view.dispatch({ effects: addOverflowBlock.of({ block: { id: newId("ov"), text, createdAt: Date.now() }, index: 0 }), annotations: noHistory });
		}),
		updateBlock: withEditor(controller, (view, blockId: string, text: string) => {
			if (text.trim() === "") view.dispatch({ effects: removeOverflowBlock.of({ id: blockId }), annotations: noHistory });
			else view.dispatch({ effects: updateOverflowBlock.of({ id: blockId, text }), annotations: noHistory });
		}),
		deleteBlock: withEditor(controller, (view, blockId: string) => {
			view.dispatch({ effects: removeOverflowBlock.of({ id: blockId }), annotations: noHistory });
		}),
		moveBlock: withEditor(controller, (view, blockId: string, index: number) => {
			view.dispatch({ effects: moveOverflowBlock.of({ id: blockId, index }), annotations: noHistory });
		}),
		insertAtCursor: withEditor(controller, (view, blockId: string, keepCopy: boolean) => {
			if (runAction(view, insertOverflowBlock(view.state, blockId, view.state.selection.main.head, keepCopy))) view.focus();
		}),
		promoteToAlternative: withEditor(controller, (view, blockId: string) => {
			const spanId = deps.panelSpanId();
			const text = blockText(view, blockId);
			if (!spanId || !text) {
				new Notice("Open alternatives for some text first.");
				return;
			}
			const result = addVersionToSpan(view.state, spanId, text, "human", { articleFix: deps.articleFix(), activate: true });
			if (!result.ok) {
				new Notice(result.message);
				return;
			}
			const effects = result.spec.effects ? (Array.isArray(result.spec.effects) ? result.spec.effects : [result.spec.effects]) : [];
			view.dispatch(isolated({ ...result.spec, effects: [...effects, removeOverflowBlock.of({ id: blockId })] }));
		}),
		copyBlock: withEditor(controller, (view, blockId: string) => {
			const text = blockText(view, blockId);
			if (text) void navigator.clipboard.writeText(text).then(() => new Notice("Copied."));
		}),
	};
}
