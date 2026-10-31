import type { EditorView } from "@codemirror/view";
import { Notice, type Command, type Hotkey } from "obsidian";
import { removeRanges } from "../core/text/clean";
import { cycleSpan, deleteAllGhosts, ghostRange, removeAiVersions, reviveRange, settleSpans, stashRange } from "../editor/actions";
import { ghosts } from "../editor/collections";
import { runAction } from "../editor/interaction";
import { listSpans, spanAt } from "../editor/spansField";
import { ALTERNATIVES_VIEW, LINT_VIEW, OVERFLOW_VIEW } from "../views/panelViews";
import { confirmAction } from "./modals";
import type VikalpPlugin from "../main";
import { startAlternatives } from "./viewActions";

const mod = (key: string, shift = false): Hotkey[] => [{ modifiers: shift ? ["Mod", "Shift"] : ["Mod"], key }];

/** The span the user means: the one at the cursor, else the one in the panel. */
export function targetSpan(plugin: VikalpPlugin, view: EditorView): string | null {
	return spanAt(view.state, view.state.selection.main.head) ?? plugin.store.getState().panelSpanId;
}

type EditorCommand = Omit<Command, "callback" | "editorCallback" | "checkCallback"> & { run: (view: EditorView) => void };

function addEditorCommand(plugin: VikalpPlugin, command: EditorCommand) {
	const { run, ...rest } = command;
	plugin.addCommand({
		...rest,
		checkCallback: (checking) => {
			const view = plugin.controller.editor;
			if (!view) return false;
			if (!checking) run(view);
			return true;
		},
	});
}

/** The commands that get Vikalp's suggested hotkeys when the writer turns them on. */
export const HOTKEY_COMMANDS = { actions: "actions", alternatives: "alternatives-for-selection", askAi: "ai-alternatives-for-selection", settle: "settle-span" } as const;

/**
 * Registers the hotkey commands, with the suggested hotkeys as their defaults
 * or with none. Hotkeys the writer set in Settings → Hotkeys win either way.
 */
export function registerHotkeyCommands(plugin: VikalpPlugin, withHotkeys: boolean) {
	const keys = (key: string, shift = false) => (withHotkeys ? mod(key, shift) : undefined);
	addEditorCommand(plugin, { id: HOTKEY_COMMANDS.actions, name: "Actions menu", icon: "zap", hotkeys: keys("."), run: (view) => plugin.actionMenu.open(view) });
	addEditorCommand(plugin, {
		id: HOTKEY_COMMANDS.alternatives,
		name: "Alternatives for selection",
		icon: "split",
		hotkeys: keys("J"),
		run: (view) => startAlternatives(plugin.alternativesDeps, view),
	});
	addEditorCommand(plugin, {
		id: HOTKEY_COMMANDS.askAi,
		name: "AI alternatives for selection",
		icon: "sparkles",
		hotkeys: keys("J", true),
		run: (view) => startAlternatives(plugin.alternativesDeps, view, undefined, { askAi: true }),
	});
	addEditorCommand(plugin, {
		id: HOTKEY_COMMANDS.settle,
		name: "Settle: keep the showing version",
		icon: "check",
		hotkeys: keys("Enter", true),
		run: (view) => {
			const spanId = targetSpan(plugin, view);
			if (!spanId) new Notice("Put the cursor on text that has versions first.");
			else runAction(view, settleSpans(view.state, [spanId]));
		},
	});
}

export function registerCommands(plugin: VikalpPlugin) {
	const editorCommand = (command: EditorCommand) => addEditorCommand(plugin, command);
	const selectionOf = (view: EditorView) => ({ from: view.state.selection.main.from, to: view.state.selection.main.to });

	editorCommand({ id: "toggle-markers", name: "Toggle markers", run: (view) => plugin.toggleMarkers(view) });
	registerHotkeyCommands(plugin, plugin.settings.suggestedHotkeys);
	editorCommand({ id: "find-spots", name: "Find words worth playing with (AI)", icon: "sparkles", run: () => plugin.findSpots() });
	editorCommand({ id: "remove-all-ai-alternatives", name: "Remove all AI versions in note", run: () => plugin.removeAllAiVersions() });
	editorCommand({
		id: "next-version",
		name: "Next version (at cursor)",
		run: (view) => {
			const spanId = targetSpan(plugin, view);
			if (spanId) runAction(view, cycleSpan(view.state, spanId, 1, plugin.switchOptions()));
		},
	});
	editorCommand({
		id: "previous-version",
		name: "Previous version (at cursor)",
		run: (view) => {
			const spanId = targetSpan(plugin, view);
			if (spanId) runAction(view, cycleSpan(view.state, spanId, -1, plugin.switchOptions()));
		},
	});
	editorCommand({ id: "settle-all", name: "Settle all alternatives in note", run: (view) => void settleAll(plugin, view) });
	editorCommand({
		id: "remove-ai-alternatives",
		name: "Remove AI versions here",
		run: (view) => {
			const spanId = targetSpan(plugin, view);
			if (!spanId) new Notice("Put the cursor on text that has versions first.");
			else runAction(view, removeAiVersions(view.state, spanId, plugin.switchOptions()));
		},
	});
	editorCommand({ id: "edit-span-note", name: "Edit note on alternatives", run: (view) => editSpanNote(plugin, view) });

	editorCommand({ id: "ghost-selection", name: "Ghost it", icon: "ghost", run: (view) => runAction(view, ghostRange(view.state, selectionOf(view))) });
	editorCommand({ id: "revive", name: "Revive at cursor", run: (view) => runAction(view, reviveRange(view.state, selectionOf(view))) });
	editorCommand({
		id: "delete-all-ghosted",
		name: "Delete all ghosted text in note",
		run: (view) => void deleteGhosted(plugin, view),
	});

	editorCommand({ id: "stash-selection", name: "Stash in Overflow", icon: "layers", run: (view) => stash(plugin, view) });
	plugin.addCommand({ id: "toggle-overflow", name: "Toggle Overflow panel", icon: "layers", callback: () => void plugin.panels.toggle(OVERFLOW_VIEW, "right") });
	plugin.addCommand({ id: "toggle-alternatives", name: "Toggle Alternatives panel", icon: "split", callback: () => void plugin.panels.toggle(ALTERNATIVES_VIEW, "left") });
	plugin.addCommand({ id: "toggle-lint", name: "Toggle Lint panel", icon: "scan-text", callback: () => void plugin.panels.toggle(LINT_VIEW, "right") });

	editorCommand({ id: "run-linter", name: "Run linter", icon: "scan-text", run: () => void plugin.linter.run() });
	editorCommand({ id: "clear-lint", name: "Clear lint marks", run: () => plugin.linter.clear() });
	editorCommand({ id: "new-rule-from-selection", name: "New rule from selection", run: (view) => void plugin.linter.newRuleFromSelection(view) });

	plugin.addCommand({ id: "open-lab", name: "Open the Lab", icon: "flask-conical", callback: () => plugin.labPopover.toggle(document.querySelector<HTMLElement>(".vk-status-lab")) });
	plugin.addCommand({ id: "show-cost-log", name: "Show AI cost log", callback: () => plugin.showCostLog() });

	editorCommand({ id: "copy-clean-text", name: "Copy clean text", run: (view) => copyClean(view, false) });
	editorCommand({ id: "copy-clean-selection", name: "Copy clean selection", run: (view) => copyClean(view, true) });
	editorCommand({ id: "read-through", name: "Read-through mode", icon: "glasses", run: (view) => plugin.readThrough.toggle(view) });
}

export function editSpanNote(plugin: VikalpPlugin, view: EditorView) {
	const spanId = targetSpan(plugin, view);
	if (!spanId) {
		new Notice("Put the cursor on text that has versions first.");
		return;
	}
	plugin.controller.setPanelSpan(spanId);
	void plugin.panels.open(ALTERNATIVES_VIEW, "left", { focus: true }).then(() => {
		window.setTimeout(() => document.querySelector<HTMLInputElement>(".vk-note-field input")?.focus(), 50);
	});
}

export function stash(plugin: VikalpPlugin, view: EditorView) {
	if (runAction(view, stashRange(view.state, { from: view.state.selection.main.from, to: view.state.selection.main.to }))) {
		void plugin.panels.openOverflow();
	}
}

export async function settleAll(plugin: VikalpPlugin, view: EditorView) {
	const spans = listSpans(view.state).filter((span) => !span.meta.hiddenIn);
	if (spans.length === 0) {
		new Notice("No alternatives in this note.");
		return;
	}
	const withNotes = spans.filter((span) => span.meta.note?.trim()).length;
	const noteWarning = withNotes > 0 ? ` ${withNotes} ${withNotes === 1 ? "has a note" : "have notes"}, which will go too.` : "";
	const confirmed = await confirmAction(plugin.app, {
		title: "Settle all?",
		body: `Keeps the showing version in ${spans.length} ${spans.length === 1 ? "place" : "places"} and drops the rest.${noteWarning} Undo brings them back.`,
		confirmLabel: "Settle all",
	});
	if (confirmed && runAction(view, settleSpans(view.state, spans.map((span) => span.meta.id)))) {
		new Notice(`Settled ${spans.length} ${spans.length === 1 ? "place" : "places"}. No alternatives left in this note.`);
	}
}

export async function deleteGhosted(plugin: VikalpPlugin, view: EditorView) {
	const count = ghosts.list(view.state).length;
	if (count === 0) {
		new Notice("No ghosted text in this note.");
		return;
	}
	const confirmed = await confirmAction(plugin.app, {
		title: "Delete all ghosted text?",
		body: `Deletes ${count} ghosted ${count === 1 ? "passage" : "passages"} from the note. Undo brings them back.`,
		confirmLabel: "Delete",
		warning: true,
	});
	if (confirmed) runAction(view, deleteAllGhosts(view.state));
}

export function copyClean(view: EditorView, selectionOnly: boolean) {
	const doc = view.state.doc.toString();
	const selection = view.state.selection.main;
	if (selectionOnly && selection.empty) {
		new Notice("Select some text first.");
		return;
	}
	const within = selectionOnly ? { from: selection.from, to: selection.to } : { from: 0, to: doc.length };
	const text = removeRanges(doc, ghosts.list(view.state).map((entry) => entry.range), within);
	void navigator.clipboard.writeText(text).then(() => new Notice(selectionOnly ? "Copied the selection without ghosted text." : "Copied the note without ghosted text."));
}
