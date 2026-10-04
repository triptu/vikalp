import type { App, WorkspaceLeaf } from "obsidian";
import { ALTERNATIVES_VIEW, AlternativesView, LINT_VIEW, OVERFLOW_VIEW } from "../views/panelViews";

type Side = "left" | "right";

/** Opens, reveals and toggles Vikalp's side panels. */
export class Panels {
	private warnedNoLeftLeaf = false;

	constructor(private readonly app: App) {}

	private existing(type: string): WorkspaceLeaf | null {
		return this.app.workspace.getLeavesOfType(type)[0] ?? null;
	}

	async open(type: string, side: Side, options: { focus?: boolean } = {}): Promise<WorkspaceLeaf | null> {
		let leaf = this.existing(type);
		if (!leaf) {
			leaf = side === "left" ? this.app.workspace.getLeftLeaf(false) : this.app.workspace.getRightLeaf(false);
			if (!leaf && side === "left") {
				if (!this.warnedNoLeftLeaf) console.info("Vikalp: no left sidebar leaf available, opening on the right.");
				this.warnedNoLeftLeaf = true;
				leaf = this.app.workspace.getRightLeaf(false);
			}
			if (!leaf) return null;
			await leaf.setViewState({ type, active: options.focus ?? false });
		}
		await this.app.workspace.revealLeaf(leaf);
		if (options.focus) this.app.workspace.setActiveLeaf(leaf, { focus: true });
		return leaf;
	}

	async toggle(type: string, side: Side) {
		const leaf = this.existing(type);
		if (leaf && this.isVisible(leaf)) {
			leaf.detach();
			return;
		}
		await this.open(type, side);
	}

	private isVisible(leaf: WorkspaceLeaf): boolean {
		const element = (leaf as unknown as { containerEl?: HTMLElement }).containerEl;
		return Boolean(element && element.isShown?.());
	}

	/** Opens the Alternatives panel and puts the cursor in its input row. */
	async focusAlternativesInput() {
		const leaf = await this.open(ALTERNATIVES_VIEW, "left", { focus: true });
		const view = leaf?.view;
		if (view instanceof AlternativesView) view.focusInput();
	}

	/** Collapses the sidebar holding the Alternatives panel, as Esc does in the demo. */
	closeAlternatives() {
		const leaf = this.existing(ALTERNATIVES_VIEW);
		if (!leaf) return;
		const root = leaf.getRoot();
		if (root === this.app.workspace.leftSplit) this.app.workspace.leftSplit.collapse();
		else if (root === this.app.workspace.rightSplit) this.app.workspace.rightSplit.collapse();
	}

	openLint() {
		return this.open(LINT_VIEW, "right");
	}

	openOverflow() {
		return this.open(OVERFLOW_VIEW, "right");
	}

	collapseSidebars() {
		const collapsed = { left: this.app.workspace.leftSplit.collapsed, right: this.app.workspace.rightSplit.collapsed };
		this.app.workspace.leftSplit.collapse();
		this.app.workspace.rightSplit.collapse();
		return collapsed;
	}

	restoreSidebars(state: { left: boolean; right: boolean }) {
		if (!state.left) this.app.workspace.leftSplit.expand();
		if (!state.right) this.app.workspace.rightSplit.expand();
	}
}
