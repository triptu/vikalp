import type { EditorView } from "@codemirror/view";
import type { Menu } from "obsidian";
import { ghostRange, reviveRange, settleSpans } from "../editor/actions";
import { ghosts } from "../editor/collections";
import { runAction } from "../editor/interaction";
import { noteModeField } from "../editor/noteFields";
import { listSpans, spanAt, spanMeta } from "../editor/spansField";
import type VikalpPlugin from "../main";
import { copyClean, editSpanNote, settleAll, stash } from "./commands";
import { startAlternatives } from "./viewActions";

/** Adds Vikalp's items to the editor's right-click menu. */
export function fillEditorMenu(plugin: VikalpPlugin, menu: Menu, view: EditorView) {
	if (view.state.field(noteModeField).readThrough) return;
	const selection = view.state.selection.main;
	const hasSelection = !selection.empty;
	const ghostHere = selection.empty ? ghosts.at(view.state, selection.head) : ghosts.overlapping(view.state, selection);
	const spanId = spanAt(view.state, selection.head);
	const span = spanId ? spanMeta(view.state, spanId) : undefined;

	menu.addSeparator();
	if (hasSelection || span) {
		menu.addItem((item) =>
			item
				.setTitle(span && !hasSelection ? "Alternatives for this" : "Alternatives for selection")
				.setIcon("split")
				.setSection("vikalp")
				.onClick(() => startAlternatives(plugin.alternativesDeps, view)),
		);
		menu.addItem((item) =>
			item
				.setTitle("AI alternatives for selection")
				.setIcon("sparkles")
				.setSection("vikalp")
				.onClick(() => startAlternatives(plugin.alternativesDeps, view, undefined, { askAi: true })),
		);
	}
	if (hasSelection && view.state.doc.sliceString(selection.from, selection.to).split(/\s+/).length > 12) {
		menu.addItem((item) =>
			item
				.setTitle("Find words worth playing with")
				.setIcon("wand-sparkles")
				.setSection("vikalp")
				.onClick(() => plugin.findSpots()),
		);
	}
	if (ghostHere.length > 0) {
		menu.addItem((item) =>
			item
				.setTitle("Revive")
				.setIcon("eye")
				.setSection("vikalp")
				.onClick(() => runAction(view, reviveRange(view.state, { from: selection.from, to: selection.to }))),
		);
	} else if (hasSelection) {
		menu.addItem((item) =>
			item
				.setTitle("Ghost it")
				.setIcon("ghost")
				.setSection("vikalp")
				.onClick(() => runAction(view, ghostRange(view.state, { from: selection.from, to: selection.to }))),
		);
	}
	if (hasSelection) {
		menu.addItem((item) =>
			item
				.setTitle("Stash in Overflow")
				.setIcon("layers")
				.setSection("vikalp")
				.onClick(() => stash(plugin, view)),
		);
	}
	if (span) {
		menu.addItem((item) =>
			item
				.setTitle(span.note ? "Edit note" : "Add a note")
				.setIcon("sticky-note")
				.setSection("vikalp")
				.onClick(() => editSpanNote(plugin, view)),
		);
		if (span.versions.length > 1) {
			menu.addItem((item) =>
				item
					.setTitle("Settle: keep the showing version")
					.setIcon("check")
					.setSection("vikalp")
					.onClick(() => runAction(view, settleSpans(view.state, [span.id]))),
			);
		}
	}
	if (listSpans(view.state).some((candidate) => candidate.range && !candidate.meta.hiddenIn)) {
		menu.addItem((item) =>
			item
				.setTitle("Settle all alternatives")
				.setIcon("check-check")
				.setSection("vikalp")
				.onClick(() => void settleAll(plugin, view)),
		);
	}
	if (!hasSelection && ghosts.list(view.state).length > 0) {
		menu.addItem((item) =>
			item
				.setTitle("Copy clean text")
				.setIcon("clipboard-copy")
				.setSection("vikalp")
				.onClick(() => copyClean(view, false)),
		);
	}
	if (hasSelection) {
		menu.addItem((item) =>
			item
				.setTitle("Copy clean selection")
				.setIcon("clipboard-copy")
				.setSection("vikalp")
				.onClick(() => copyClean(view, true)),
		);
		menu.addItem((item) =>
			item
				.setTitle("New lint rule from selection")
				.setIcon("list-plus")
				.setSection("vikalp")
				.onClick(() => void plugin.linter.newRuleFromSelection(view)),
		);
	}
}
