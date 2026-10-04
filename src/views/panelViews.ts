import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { h, render, type ComponentChild } from "preact";
import type { VikalpViewContext } from "./context";
import { AlternativesContainer, LintContainer, OverflowContainer, Providers } from "./containers";

export const ALTERNATIVES_VIEW = "vikalp-alternatives";
export const OVERFLOW_VIEW = "vikalp-overflow";
export const LINT_VIEW = "vikalp-lint";

const renderIcon = (element: HTMLElement, name: string) => setIcon(element, name);

/** An Obsidian side-panel view that renders one Preact tree and nothing else. */
abstract class PreactPanelView extends ItemView {
	protected abstract content(): ComponentChild;

	constructor(
		leaf: WorkspaceLeaf,
		protected readonly context: VikalpViewContext,
	) {
		super(leaf);
	}

	protected renderTree() {
		render(h(Providers, { context: this.context, icon: renderIcon }, this.content()), this.contentEl);
	}

	override async onOpen() {
		this.contentEl.addClass("vk-view");
		this.renderTree();
	}

	override async onClose() {
		render(null, this.contentEl);
	}
}

export class AlternativesView extends PreactPanelView {
	private focusRequest = 0;

	getViewType() {
		return ALTERNATIVES_VIEW;
	}
	getDisplayText() {
		return "Alternatives";
	}
	override getIcon() {
		return "git-fork";
	}
	protected content() {
		return h(AlternativesContainer, { focusRequest: this.focusRequest });
	}

	/** Moves keyboard focus to the "add a version" input. */
	focusInput() {
		this.focusRequest++;
		this.renderTree();
	}
}

export class OverflowView extends PreactPanelView {
	getViewType() {
		return OVERFLOW_VIEW;
	}
	getDisplayText() {
		return "Overflow";
	}
	override getIcon() {
		return "layers";
	}
	protected content() {
		return h(OverflowContainer, {});
	}
}

export class LintView extends PreactPanelView {
	getViewType() {
		return LINT_VIEW;
	}
	getDisplayText() {
		return "Lint";
	}
	override getIcon() {
		return "scan-text";
	}
	protected content() {
		return h(LintContainer, {});
	}
}
