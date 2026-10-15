import { MarkdownView, type App } from "obsidian";
import { h, render } from "preact";
import type { UiStore } from "../store/uiStore";
import { LabContainer, Providers, TrimBarContainer } from "../views/containers";
import type { VikalpViewContext } from "../views/context";
import { renderIcon } from "../views/panelViews";


/** The Lab popover, anchored above its status bar button. Closes on outside click or Esc. */
export class LabPopoverHost {
	private container: HTMLElement | null = null;
	private anchor: HTMLElement | null = null;
	private readonly onOutsideClick = (event: MouseEvent) => {
		const target = event.target as Node;
		if (this.container?.contains(target) || this.anchor?.contains(target)) return;
		if ((target as HTMLElement).closest?.(".modal-container, .menu")) return;
		this.close();
	};
	private readonly onKey = (event: KeyboardEvent) => {
		if (event.key === "Escape" && this.container) {
			event.preventDefault();
			this.close();
		}
	};

	constructor(private readonly context: VikalpViewContext) {}

	toggle(anchor: HTMLElement | null) {
		if (this.container) this.close();
		else this.open(anchor);
	}

	open(anchor: HTMLElement | null) {
		this.close();
		this.anchor = anchor;
		const container = document.body.createDiv({ cls: "vk-lab-popover" });
		this.container = container;
		render(h(Providers, { context: this.context, icon: renderIcon }, h(LabContainer, {})), container);
		this.position();
		window.setTimeout(() => {
			if (this.container !== container) return;
			document.addEventListener("mousedown", this.onOutsideClick, true);
			document.addEventListener("keydown", this.onKey, true);
		}, 0);
		anchor?.addClass("is-active");
	}

	private position() {
		if (!this.container) return;
		const rect = this.anchor?.getBoundingClientRect();
		const width = 340;
		const right = rect ? Math.max(8, window.innerWidth - rect.right - 8) : 16;
		const bottom = rect ? window.innerHeight - rect.top + 8 : 40;
		Object.assign(this.container.style, { width: `${width}px`, right: `${right}px`, bottom: `${bottom}px` });
	}

	close() {
		if (!this.container) return;
		render(null, this.container);
		this.container.remove();
		this.container = null;
		this.anchor?.removeClass("is-active");
		this.anchor = null;
		document.removeEventListener("mousedown", this.onOutsideClick, true);
		document.removeEventListener("keydown", this.onKey, true);
	}
}

/** Mounts the trim status bar over the note that has an open trim proposal. */
export class TrimBarHost {
	private host: HTMLElement | null = null;
	private mountedIn: HTMLElement | null = null;
	private readonly unsubscribe: () => void;

	constructor(
		private readonly app: App,
		private readonly store: UiStore,
		private readonly context: VikalpViewContext,
	) {
		this.unsubscribe = store.subscribe(() => this.sync());
	}

	sync() {
		const { trim } = this.store.getState();
		const target = trim.status === "idle" || !trim.notePath ? null : this.viewFor(trim.notePath);
		const containerEl = target?.contentEl ?? null;
		if (containerEl === this.mountedIn) return;
		this.unmount();
		if (!containerEl) return;
		containerEl.addClass("vk-has-trim-bar");
		this.host = containerEl.createDiv({ cls: "vk-trim-host" });
		this.mountedIn = containerEl;
		render(h(Providers, { context: this.context, icon: renderIcon }, h(TrimBarContainer, {})), this.host);
	}

	private viewFor(path: string): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path) return leaf.view;
		}
		return null;
	}

	private unmount() {
		if (this.host) {
			render(null, this.host);
			this.host.remove();
		}
		this.mountedIn?.removeClass("vk-has-trim-bar");
		this.host = null;
		this.mountedIn = null;
	}

	dispose() {
		this.unsubscribe();
		this.unmount();
	}
}
