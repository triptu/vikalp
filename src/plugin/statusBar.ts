import { setIcon, setTooltip, type Plugin } from "obsidian";
import { MODEL_MODE_LABELS } from "../core/settings";
import type { UiStore, VikalpUiState } from "../store/uiStore";

export interface StatusBarActions {
	toggleMarkers(): void;
	openLint(): void;
	toggleLab(anchor: HTMLElement): void;
}

/**
 * Vikalp's status bar: word count (also the markers switch), lint marks, and
 * the Lab button with the model mode.
 */
export class StatusBar {
	private readonly words: HTMLElement;
	private readonly lint: HTMLElement;
	private readonly lab: HTMLElement;
	private unsubscribe: () => void = () => {};
	private lastSignature = "";

	constructor(
		plugin: Plugin,
		private readonly store: UiStore,
		actions: StatusBarActions,
	) {
		this.lint = this.item(plugin, "vk-status-lint", actions.openLint);
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
		const signature = JSON.stringify([
			note?.words,
			note?.selectedWords,
			note?.ghostWords,
			note?.markersOn,
			note?.lintHits.length,
			state.modelMode,
			state.lab.runningPass,
			state.trim.status,
			state.aiPendingSpans.length,
		]);
		if (signature === this.lastSignature) return;
		this.lastSignature = signature;
		for (const element of [this.words, this.lint]) element.toggleClass("vk-hidden", !note);
		this.renderWords(state);
		this.renderLint(state);
		this.renderLab(state);
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
		const running = state.lab.runningPass !== null || state.trim.status === "reading" || state.aiPendingSpans.length > 0;
		if (running) this.lab.createSpan({ cls: "vk-spinner" });
		this.lab.createSpan({ cls: "vk-status-lab-label", text: "Lab" });
		this.lab.createSpan({ cls: "vk-status-lab-mode", text: MODEL_MODE_LABELS[state.modelMode] });

		setTooltip(this.lab, "The Lab: AI marks, trim and model mode", { placement: "top" });
	}

	dispose() {
		this.unsubscribe();
	}
}
