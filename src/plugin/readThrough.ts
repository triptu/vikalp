import type { EditorView, ViewUpdate } from "@codemirror/view";
import { Notice } from "obsidian";
import { noteModeField, setNoteMode } from "../editor/noteFields";
import type { Panels } from "./panels";

const READABLE_CLASS = "is-readable-line-width";

/**
 * Read-through mode: hides every marker, collapses the sidebars and narrows
 * the text column so the draft reads the way a reader will see it. A view
 * state only; nothing in the note or sidecar changes.
 */
export class ReadThrough {
	private savedSidebars: { left: boolean; right: boolean } | null = null;
	private addedReadableWidth: HTMLElement | null = null;

	constructor(private readonly panels: Panels) {}

	toggle(view: EditorView) {
		if (view.state.field(noteModeField).readThrough) view.dispatch({ effects: setNoteMode.of({ readThrough: false }) });
		else this.enter(view);
	}

	private enter(view: EditorView) {
		view.dispatch({ effects: setNoteMode.of({ readThrough: true, focusedSpan: null }) });
		this.savedSidebars = this.panels.collapseSidebars();
		const sourceView = view.dom.closest<HTMLElement>(".markdown-source-view");
		if (sourceView && !sourceView.hasClass(READABLE_CLASS)) {
			sourceView.addClass(READABLE_CLASS);
			this.addedReadableWidth = sourceView;
		}
		new Notice("Read-through mode. Press Esc or ⌘⇧R to return.", 2500);
	}

	/** Restores the layout when read-through ends, however it was ended (Esc, command, status bar). */
	handleUpdate(update: ViewUpdate) {
		const was = update.startState.field(noteModeField).readThrough;
		const now = update.state.field(noteModeField).readThrough;
		if (was && !now) this.restore();
	}

	restore() {
		if (this.savedSidebars) this.panels.restoreSidebars(this.savedSidebars);
		this.savedSidebars = null;
		this.addedReadableWidth?.removeClass(READABLE_CLASS);
		this.addedReadableWidth = null;
	}
}
