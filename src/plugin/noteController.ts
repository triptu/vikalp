import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { MarkdownView, Notice, editorInfoField, type App } from "obsidian";
import { emptyNoteFile } from "../core/model/types";
import type { VikalpSettings } from "../core/settings";
import { ghosts, lintMarks, trimProposals } from "../editor/collections";
import type { VikalpHost } from "../editor/host";
import { runAction } from "../editor/interaction";
import { noteModeField, overflowField, setNoteMode } from "../editor/noteFields";
import { loadNoteEffects, serializeNote } from "../editor/serialize";
import { snapshotNote } from "../editor/snapshot";
import { removeSpan, spanMeta, spansField } from "../editor/spansField";
import { loadAnnotation, noHistory } from "../editor/transactions";
import { insertOverflowBlock } from "../editor/actions";
import type { SidecarRepository } from "../persistence/sidecar";
import type { UiStore } from "../store/uiStore";

interface EditorEntry {
	path: string | null;
	lastState: EditorState;
	saveTimer: number | null;
	loadToken: number;
}

const SAVE_DELAY_MS = 500;

export interface ControllerHooks {
	applyLintFix(view: EditorView, hitId: string): void;
	ignoreLintHit(view: EditorView, hitId: string): void;
	vetoProposal(view: EditorView, proposalId: string): void;
	noteChanged(view: EditorView, update: ViewUpdate): void;
}

/**
 * Connects CodeMirror editors to the rest of Vikalp: loads each note's sidecar
 * into its editor, saves changes back, tracks the active editor, and publishes
 * a snapshot of the active note to the UI store.
 */
export class NoteController implements VikalpHost {
	private readonly editors = new Map<EditorView, EditorEntry>();
	private activeView: EditorView | null = null;
	private publishFrame: number | null = null;
	hooks: ControllerHooks | null = null;

	constructor(
		private readonly app: App,
		private readonly repository: SidecarRepository,
		private readonly store: UiStore,
		private readonly getSettings: () => VikalpSettings,
	) {}

	settings() {
		const { articleFix, hoverCycling } = this.getSettings();
		return { articleFix, hoverCycling };
	}

	notify(message: string) {
		new Notice(message, 3500);
	}

	editorCreated(view: EditorView) {
		const entry: EditorEntry = { path: null, lastState: view.state, saveTimer: null, loadToken: 0 };
		this.editors.set(view, entry);
		const path = pathOf(view.state);
		if (path) {
			entry.path = path;
			void this.loadInto(view, entry, path);
		}
		window.setTimeout(() => this.refreshActiveView(), 0);
	}

	editorUpdated(update: ViewUpdate) {
		const entry = this.editors.get(update.view);
		if (!entry) return;
		const path = pathOf(update.state);
		if (path && path !== entry.path) {
			if (entry.path) this.flushSave(entry, update.startState);
			entry.path = path;
			entry.lastState = update.state;
			this.resetEditor(update.view);
			void this.loadInto(update.view, entry, path);
			return;
		}
		entry.lastState = update.state;
		const isLoad = update.transactions.some((tr) => tr.annotation(loadAnnotation));
		const vikalpChanged = fieldsChanged(update.startState, update.state);
		if (!isLoad && update.state.field(noteModeField).loaded && (vikalpChanged || (update.docChanged && hasVikalpData(update.state)))) {
			this.scheduleSave(entry);
		}
		if (update.view === this.activeView && (update.docChanged || update.selectionSet || vikalpChanged || isLoad)) this.schedulePublish();
		if (update.docChanged || vikalpChanged) this.hooks?.noteChanged(update.view, update);
	}

	editorDestroyed(view: EditorView) {
		const entry = this.editors.get(view);
		if (entry) this.flushSave(entry, entry.lastState);
		this.editors.delete(view);
		if (this.activeView === view) {
			this.activeView = null;
			window.setTimeout(() => this.refreshActiveView(), 0);
		}
	}

	applyLintFix(view: EditorView, hitId: string) {
		this.hooks?.applyLintFix(view, hitId);
	}

	ignoreLintHit(view: EditorView, hitId: string) {
		this.hooks?.ignoreLintHit(view, hitId);
	}

	vetoProposal(view: EditorView, proposalId: string) {
		this.hooks?.vetoProposal(view, proposalId);
	}

	dropOverflowBlock(view: EditorView, blockId: string, position: number, keepCopy: boolean) {
		runAction(view, insertOverflowBlock(view.state, blockId, position, keepCopy));
		view.focus();
	}

	/** The editor of the note the user is working in, even while a Vikalp panel has focus. */
	get editor(): EditorView | null {
		if (this.activeView && !this.editors.has(this.activeView)) this.activeView = null;
		return this.activeView;
	}

	get activePath(): string | null {
		const view = this.editor;
		return view ? (this.editors.get(view)?.path ?? null) : null;
	}

	/** Re-reads which markdown editor is active. Called on leaf changes. */
	refreshActiveView() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const view = markdownView ? editorViewOf(markdownView) : null;
		if (view && this.editors.has(view)) {
			if (view !== this.activeView) {
				const previous = this.activeView;
				this.activeView = view;
				if (previous) this.clearTransientState(previous);
				this.store.setState({ panelSpanId: null });
				this.publishNow();
			}
		} else if (!this.activeView || !this.editors.has(this.activeView)) {
			const fallback = this.findAnyVisibleEditor();
			this.activeView = fallback;
			this.publishNow();
		}
	}

	private findAnyVisibleEditor(): EditorView | null {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (leaf?.view instanceof MarkdownView) {
			const view = editorViewOf(leaf.view);
			if (view && this.editors.has(view)) return view;
		}
		return null;
	}

	dispatch(spec: TransactionSpec) {
		this.editor?.dispatch(spec);
	}

	setPanelSpan(spanId: string | null) {
		const previous = this.store.getState().panelSpanId;
		if (previous === spanId) return;
		this.store.setState({ panelSpanId: spanId });
		if (previous) this.pruneSingleVersionSpan(previous);
		this.syncFocusDimming();
	}

	setPanelFocused(focused: boolean) {
		if (this.store.getState().panelFocused === focused) return;
		this.store.setState({ panelFocused: focused });
		this.syncFocusDimming();
	}

	private syncFocusDimming() {
		const view = this.editor;
		if (!view) return;
		const { panelFocused, panelSpanId } = this.store.getState();
		const focusedSpan = panelFocused ? panelSpanId : null;
		if (view.state.field(noteModeField).focusedSpan !== focusedSpan) view.dispatch({ effects: setNoteMode.of({ focusedSpan }) });
	}

	/** A span created for the panel but never given a second version is quietly dropped. */
	pruneSingleVersionSpan(spanId: string) {
		const view = this.editor;
		const meta = view ? spanMeta(view.state, spanId) : undefined;
		if (view && meta && meta.versions.length < 2) view.dispatch({ effects: removeSpan.of({ id: spanId }), annotations: noHistory });
	}

	private clearTransientState(view: EditorView) {
		if (!this.editors.has(view)) return;
		const mode = view.state.field(noteModeField);
		if (mode.focusedSpan) view.dispatch({ effects: setNoteMode.of({ focusedSpan: null }) });
		const panelSpan = this.store.getState().panelSpanId;
		if (panelSpan) {
			const meta = spanMeta(view.state, panelSpan);
			if (meta && meta.versions.length < 2) view.dispatch({ effects: removeSpan.of({ id: panelSpan }), annotations: noHistory });
		}
	}

	schedulePublish() {
		if (this.publishFrame !== null) return;
		this.publishFrame = window.requestAnimationFrame(() => {
			this.publishFrame = null;
			this.publishNow();
		});
	}

	publishNow() {
		const view = this.editor;
		const path = view ? this.editors.get(view)?.path : null;
		if (!view || !path) {
			this.store.setState({ note: null });
			return;
		}
		const note = snapshotNote(view.state, path);
		const { panelSpanId } = this.store.getState();
		let nextPanelSpan = panelSpanId;
		if (note.cursorSpanId && note.cursorSpanId !== panelSpanId && note.spans.some((span) => span.id === note.cursorSpanId && !span.orphaned)) {
			nextPanelSpan = note.cursorSpanId;
		}
		if (nextPanelSpan && !note.spans.some((span) => span.id === nextPanelSpan)) nextPanelSpan = null;
		this.store.setState({ note });
		if (nextPanelSpan !== panelSpanId) this.setPanelSpan(nextPanelSpan);
	}

	private resetEditor(view: EditorView) {
		const report = loadNoteEffects(view.state.doc.toString(), emptyNoteFile("", false));
		view.dispatch({
			effects: [...report.effects, trimProposals.effects.replaceAll.of([]), setNoteMode.of({ loaded: false, readThrough: false, focusedSpan: null, walkProposal: null })],
			annotations: [noHistory, loadAnnotation.of(true)],
		});
	}

	private async loadInto(view: EditorView, entry: EditorEntry, path: string) {
		const token = ++entry.loadToken;
		const note = await this.repository.load(path);
		if (this.editors.get(view) !== entry || entry.loadToken !== token || entry.path !== path) return;
		const doc = view.state.doc.toString();
		const report = loadNoteEffects(doc, note ?? emptyNoteFile(path, this.getSettings().markersOnByDefault));
		view.dispatch({
			effects: [...report.effects, setNoteMode.of({ path, loaded: true })],
			annotations: [noHistory, loadAnnotation.of(true)],
		});
		if (report.orphaned > 0) {
			const noun = report.orphaned === 1 ? "alternative" : "alternatives";
			new Notice(`Vikalp: ${report.orphaned} ${noun} could not be placed in "${path}". They are listed under Unplaced in the Alternatives panel.`, 8000);
		}
		if (view === this.activeView) this.publishNow();
	}

	private scheduleSave(entry: EditorEntry) {
		if (entry.saveTimer !== null) window.clearTimeout(entry.saveTimer);
		entry.saveTimer = window.setTimeout(() => {
			entry.saveTimer = null;
			this.writeSidecar(entry, entry.lastState);
		}, SAVE_DELAY_MS);
	}

	private flushSave(entry: EditorEntry, state: EditorState) {
		if (entry.saveTimer === null) return;
		window.clearTimeout(entry.saveTimer);
		entry.saveTimer = null;
		this.writeSidecar(entry, state);
	}

	private writeSidecar(entry: EditorEntry, state: EditorState) {
		const path = entry.path;
		if (!path || !state.field(noteModeField, false)?.loaded) return;
		const lintRanAt = this.store.getState().lint.notePath === path ? this.store.getState().lint.ranAt : null;
		const { note, isEmpty } = serializeNote(state, path, lintRanAt);
		this.repository.save(path, note, isEmpty).catch((error) => {
			console.error("Vikalp: could not save sidecar", error);
			new Notice("Vikalp could not save this note's alternatives. See the console for details.");
		});
	}

	/** Writes every pending sidecar now. Called when the plugin unloads. */
	flushAll() {
		for (const entry of this.editors.values()) this.flushSave(entry, entry.lastState);
	}

	/** Keeps open editors and sidecars in step when a note is renamed. */
	async handleRename(newPath: string, oldPath: string) {
		for (const [view, entry] of this.editors) {
			if (entry.path !== oldPath) continue;
			this.flushSave(entry, entry.lastState);
			entry.path = newPath;
			view.dispatch({ effects: setNoteMode.of({ path: newPath }), annotations: [noHistory, loadAnnotation.of(true)] });
		}
		await this.repository.rename(oldPath, newPath);
		for (const entry of this.editors.values()) if (entry.path === newPath) this.scheduleSave(entry);
		this.publishNow();
	}

	async handleDelete(path: string) {
		await this.repository.archive(path);
	}

	allEditors(): EditorView[] {
		return [...this.editors.keys()];
	}
}

const TRACKED_FIELDS = [spansField, ghosts.field, lintMarks.field, trimProposals.field, overflowField, noteModeField] as const;

function fieldsChanged(start: EditorState, end: EditorState): boolean {
	return TRACKED_FIELDS.some((field) => start.field(field as never, false) !== end.field(field as never, false));
}

function hasVikalpData(state: EditorState): boolean {
	const spans = state.field(spansField, false);
	return Boolean(spans && spans.meta.size > 0) || ghosts.list(state).length > 0 || lintMarks.list(state).length > 0;
}

export function pathOf(state: EditorState): string | null {
	const info = state.field(editorInfoField, false);
	return info?.file?.path ?? null;
}

export function editorViewOf(view: MarkdownView): EditorView | null {
	const editor = view.editor as unknown as { cm?: EditorView };
	return editor.cm ?? null;
}

