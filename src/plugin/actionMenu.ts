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
import { copyClean, HOTKEY_COMMANDS, stash } from "./commands";
import { hotkeyFor } from "./hotkeys";
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
		const items: (ActionMenuItem & { commandId: string })[] = [
			{ key: "A", label: "Alternatives", icon: "split", commandId: HOTKEY_COMMANDS.alternatives, run: () => startAlternatives(plugin.alternativesDeps, view) },
			{ key: "I", label: "Ask AI for versions", icon: "sparkles", commandId: HOTKEY_COMMANDS.askAi, run: () => startAlternatives(plugin.alternativesDeps, view, undefined, { askAi: true }) },
			{ key: "F", label: "Find words worth playing with", icon: "wand-sparkles", commandId: "find-spots", run: () => plugin.findSpots() },
			onGhost
				? { key: "G", label: "Revive", icon: "eye", commandId: "revive", run: () => runAction(view, reviveRange(view.state, { from: selection.from, to: selection.to })) }
				: { key: "G", label: "Ghost it", icon: "ghost", commandId: "ghost-selection", unavailable: needsSelection, run: () => runAction(view, ghostRange(view.state, { from: selection.from, to: selection.to })) },
			{ key: "S", label: "Stash in Overflow", icon: "layers", commandId: "stash-selection", unavailable: needsSelection, run: () => stash(plugin, view) },
			{ key: "L", label: "Run linter", icon: "scan-text", commandId: "run-linter", run: () => void plugin.linter.run() },
			{ key: "T", label: "Open the Lab", icon: "flask-conical", commandId: "open-lab", run: () => plugin.labPopover.toggle(document.querySelector<HTMLElement>(".vk-status-lab")) },
			{ key: "R", label: "Read-through", icon: "glasses", commandId: "read-through", run: () => plugin.readThrough.toggle(view) },
			{ key: "C", label: hasSelection ? "Copy clean selection" : "Copy clean text", icon: "clipboard-copy", commandId: hasSelection ? "copy-clean-selection" : "copy-clean-text", run: () => copyClean(view, hasSelection) },
		];
		return items.map(({ commandId, ...item }) => ({ ...item, hotkey: hotkeyFor(plugin.app, commandId) ?? undefined }));
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
