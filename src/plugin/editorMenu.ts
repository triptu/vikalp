import type { EditorView } from "@codemirror/view";
import type { Menu } from "obsidian";
import { ghostRange, reviveRange, settleSpans } from "../editor/actions";
import { ghosts } from "../editor/collections";
import { runAction } from "../editor/interaction";
import { noteModeField } from "../editor/noteFields";
import { listSpans, spanAt, spanMeta } from "../editor/spansField";
import type VikalpPlugin from "../main";
import { copyClean, editSpanNote, HOTKEY_COMMANDS, settleAll, stash } from "./commands";
import { menuTitle } from "./hotkeys";
import { startAlternatives } from "./viewActions";

/** Adds Vikalp's items to the editor's right-click menu. */
export function fillEditorMenu(plugin: VikalpPlugin, menu: Menu, view: EditorView) {
	if (view.state.field(noteModeField).readThrough) return;
	const selection = view.state.selection.main;
	const hasSelection = !selection.empty;
	const ghostHere = selection.empty ? ghosts.at(view.state, selection.head) : ghosts.overlapping(view.state, selection);
	const spanId = spanAt(view.state, selection.head);
	const span = spanId ? spanMeta(view.state, spanId) : undefined;

	const add = (title: string, icon: string, commandId: string, run: () => void) =>
		menu.addItem((item) => item.setTitle(menuTitle(plugin.app, title, commandId)).setIcon(icon).setSection("vikalp").onClick(run));

	menu.addSeparator();
	if (hasSelection || span) {
		add(span && !hasSelection ? "Alternatives for this" : "Alternatives for selection", "split", HOTKEY_COMMANDS.alternatives, () => startAlternatives(plugin.alternativesDeps, view));
		add("AI alternatives for selection", "sparkles", HOTKEY_COMMANDS.askAi, () => startAlternatives(plugin.alternativesDeps, view, undefined, { askAi: true }));
	}
	if (hasSelection && view.state.doc.sliceString(selection.from, selection.to).split(/\s+/).length > 12) {
		add("Find words worth playing with", "wand-sparkles", "find-spots", () => plugin.findSpots());
	}
	if (ghostHere.length > 0) {
		add("Revive", "eye", "revive", () => runAction(view, reviveRange(view.state, { from: selection.from, to: selection.to })));
	} else if (hasSelection) {
		add("Ghost it", "ghost", "ghost-selection", () => runAction(view, ghostRange(view.state, { from: selection.from, to: selection.to })));
	}
	if (hasSelection) {
		add("Stash in Overflow", "layers", "stash-selection", () => stash(plugin, view));
	}
	if (span) {
		add(span.note ? "Edit note" : "Add a note", "sticky-note", "edit-span-note", () => editSpanNote(plugin, view));
		if (span.versions.length > 1) {
			add("Settle: keep the showing version", "check", "settle-span", () => runAction(view, settleSpans(view.state, [span.id])));
		}
	}
	if (listSpans(view.state).some((candidate) => candidate.range && !candidate.meta.hiddenIn)) {
		add("Settle all alternatives", "check-check", "settle-all", () => void settleAll(plugin, view));
	}
	if (!hasSelection && ghosts.list(view.state).length > 0) {
		add("Copy clean text", "clipboard-copy", "copy-clean-text", () => copyClean(view, false));
	}
	if (hasSelection) {
		add("Copy clean selection", "clipboard-copy", "copy-clean-selection", () => copyClean(view, true));
		add("New lint rule from selection", "list-plus", "new-rule-from-selection", () => void plugin.linter.newRuleFromSelection(view));
	}
	add("All Vikalp actions", "zap", HOTKEY_COMMANDS.actions, () => plugin.actionMenu.open(view));
}
