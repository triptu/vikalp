import type { EditorView } from "@codemirror/view";
import { h, render } from "preact";
import { ghostRange, reviveRange } from "../editor/actions";
import { ghosts } from "../editor/collections";
import { runAction } from "../editor/interaction";
import { noteModeField } from "../editor/noteFields";
import type VikalpPlugin from "../main";
import { ActionMenu, type ActionMenuItem } from "../views/components/ActionMenu";
import { IconContext } from "../views/components/Icon";
import { renderIcon } from "../views/panelViews";
import { copyClean, stash } from "./commands";
import { startAlternatives } from "./viewActions";

/**
 * The ⌘. menu: every Vikalp action one letter away, at the cursor. Saves
 * remembering a hotkey for each.
 */
export class ActionMenuHost {
	private container: HTMLElement | null = null;
	private returnFocus: EditorView | null = null;
	private readonly onOutsideClick = (event: MouseEvent) => {
		if (!this.container?.contains(event.target as Node)) this.close();
	};

	constructor(private readonly plugin: VikalpPlugin) {}

	open(view: EditorView) {
		this.close();
		if (view.state.field(noteModeField).readThrough) return;
		this.returnFocus = view;
		const container = document.body.createDiv({ cls: "vk-action-menu-host" });
		this.container = container;
		const head = view.state.selection.main.head;
		const coords = view.coordsAtPos(head) ?? view.dom.getBoundingClientRect();
		const left = Math.min(coords.left, window.innerWidth - 280);
		const below = coords.bottom + 6;
		Object.assign(container.style, { left: `${Math.max(8, left)}px`, top: `${below}px` });
		render(h(IconContext.Provider, { value: renderIcon }, h(ActionMenu, { items: this.items(view), onClose: () => this.close(true) })), container);
		const rect = container.getBoundingClientRect();
		if (rect.bottom > window.innerHeight - 8) container.style.top = `${Math.max(8, coords.top - rect.height - 6)}px`;
		window.setTimeout(() => document.addEventListener("mousedown", this.onOutsideClick, true), 0);
	}

	private items(view: EditorView): ActionMenuItem[] {
		const plugin = this.plugin;
		const selection = view.state.selection.main;
		const hasSelection = !selection.empty;
		const onGhost = (selection.empty ? ghosts.at(view.state, selection.head) : ghosts.overlapping(view.state, selection)).length > 0;
		const needsSelection = hasSelection ? undefined : "Select some text first";
		return [
			{ key: "A", label: "Alternatives", icon: "split", run: () => startAlternatives(plugin.alternativesDeps, view) },
			{ key: "I", label: "Ask AI for versions", icon: "sparkles", run: () => startAlternatives(plugin.alternativesDeps, view, undefined, { askAi: true }) },
			{ key: "F", label: "Find words worth playing with", icon: "wand-sparkles", run: () => plugin.findSpots() },
			onGhost
				? { key: "G", label: "Revive", icon: "eye", run: () => runAction(view, reviveRange(view.state, { from: selection.from, to: selection.to })) }
				: { key: "G", label: "Ghost it", icon: "ghost", unavailable: needsSelection, run: () => runAction(view, ghostRange(view.state, { from: selection.from, to: selection.to })) },
			{ key: "S", label: "Stash in Overflow", icon: "layers", unavailable: needsSelection, run: () => stash(plugin, view) },
			{ key: "L", label: "Run linter", icon: "scan-text", run: () => void plugin.linter.run() },
			{ key: "T", label: "Open the Lab", icon: "flask-conical", run: () => plugin.labPopover.toggle(document.querySelector<HTMLElement>(".vk-status-lab")) },
			{ key: "R", label: "Read-through", icon: "glasses", run: () => plugin.readThrough.toggle(view) },
			{ key: "C", label: hasSelection ? "Copy clean selection" : "Copy clean text", icon: "clipboard-copy", run: () => copyClean(view, hasSelection) },
		];
	}

	close(restoreFocus = false) {
		if (!this.container) return;
		render(null, this.container);
		this.container.remove();
		this.container = null;
		document.removeEventListener("mousedown", this.onOutsideClick, true);
		if (restoreFocus && this.returnFocus && !document.activeElement?.closest(".vk-panel, .vk-lab-popover, .modal")) this.returnFocus.focus();
		this.returnFocus = null;
	}
}
