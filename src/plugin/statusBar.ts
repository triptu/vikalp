import { setIcon, setTooltip, type Plugin } from "obsidian";
import { MODEL_MODE_LABELS, type VikalpSettings } from "../core/settings";
import { sessionCost, type UiStore, type VikalpUiState } from "../store/uiStore";
import { formatCost } from "../views/format";

export interface StatusBarActions {
	toggleMarkers(): void;
	openLint(): void;
	toggleLab(anchor: HTMLElement): void;
	showCostLog(): void;
	toggleReadThrough(): void;
}

/**
 * Vikalp's status bar: word count (also the markers switch), lint marks, the
 * Lab button with the model mode, session cost, and read-through.
 */
export class StatusBar {
	private readonly words: HTMLElement;
	private readonly lint: HTMLElement;
	private readonly lab: HTMLElement;
	private readonly cost: HTMLElement;
	private readonly readThrough: HTMLElement;
	private unsubscribe: () => void = () => {};

	constructor(
		plugin: Plugin,
		private readonly store: UiStore,
		private readonly getSettings: () => VikalpSettings,
		actions: StatusBarActions,
	) {
		this.readThrough = this.item(plugin, "vk-status-read", actions.toggleReadThrough);
		setIcon(this.readThrough.createSpan({ cls: "vk-status-icon" }), "book-open");
		setTooltip(this.readThrough, "Read-through mode (⌘⇧R)", { placement: "top" });

		this.lint = this.item(plugin, "vk-status-lint", actions.openLint);
		this.cost = this.item(plugin, "vk-status-cost", actions.showCostLog);
		setTooltip(this.cost, "AI spend this session. Click for the log.", { placement: "top" });
		this.lab = this.item(plugin, "vk-status-lab", () => actions.toggleLab(this.lab));
		this.words = this.item(plugin, "vk-status-words", actions.toggleMarkers);

		this.unsubscribe = store.subscribe(() => this.render());
		this.render();
	}

	private item(plugin: Plugin, className: string, onClick: () => void): HTMLElement {
		const element = plugin.addStatusBarItem();
		element.addClass("vk-status-item", className, "mod-clickable");
		element.addEventListener("click", onClick);
		return element;
	}

	render() {
		const state = this.store.getState();
		const note = state.note;
		for (const element of [this.words, this.lint, this.readThrough]) element.toggleClass("vk-hidden", !note);
		this.renderWords(state);
		this.renderLint(state);
		this.renderLab(state);
		const settings = this.getSettings();
		const spent = sessionCost(state);
		this.cost.toggleClass("vk-hidden", !settings.showCost || state.costs.length === 0);
		this.cost.setText(formatCost(spent));
		this.readThrough.toggleClass("is-active", Boolean(note?.readThrough));
	}

	private renderWords({ note }: VikalpUiState) {
		this.words.empty();
		if (!note) return;
		const markers = this.words.createSpan({ cls: `vk-status-markers${note.markersOn ? " is-on" : ""}` });
		for (let index = 0; index < 3; index++) markers.createSpan({ cls: "vk-status-marker-dot" });
		const count = note.selectedWords > 0 ? `${note.selectedWords} of ${note.words} words` : `${note.words} ${note.words === 1 ? "word" : "words"}`;
		this.words.createSpan({ text: count });
		if (note.ghostWords > 0) this.words.createSpan({ cls: "vk-status-ghosted", text: ` (+${note.ghostWords} ghosted)` });
		setTooltip(this.words, note.markersOn ? "Vikalp markers on. Click to hide them." : "Click to show Vikalp markers.", { placement: "top" });
	}

	private renderLint({ note }: VikalpUiState) {
		this.lint.empty();
		if (!note) return;
		setIcon(this.lint.createSpan({ cls: "vk-status-icon" }), "scan-text");
		const count = note.lintHits.length;
		if (count > 0) this.lint.createSpan({ cls: "vk-status-count", text: String(count) });
		setTooltip(this.lint, count > 0 ? `${count} lint ${count === 1 ? "mark" : "marks"}. Click for the list.` : "Run the linter", { placement: "top" });
	}

	private renderLab(state: VikalpUiState) {
		this.lab.empty();
		this.lab.createSpan({ cls: "vk-status-lab-label", text: "Lab" });
		this.lab.createSpan({ cls: "vk-status-lab-mode", text: MODEL_MODE_LABELS[state.modelMode] });
		const running = state.lab.runningPass !== null || state.trim.status === "reading" || state.aiPendingSpans.length > 0;
		this.lab.toggleClass("is-busy", running);
		setTooltip(this.lab, "Open the Lab: AI marks, trim and model mode", { placement: "top" });
	}

	dispose() {
		this.unsubscribe();
	}
}
