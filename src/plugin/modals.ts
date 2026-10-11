import { Modal, Setting, type App } from "obsidian";
import type { CostEntry } from "../store/uiStore";
import { formatCost } from "../views/format";

export interface ConfirmOptions {
	title: string;
	body: string;
	confirmLabel: string;
	warning?: boolean;
}

class ConfirmModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly options: ConfirmOptions,
		private readonly resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	override onOpen() {
		this.titleEl.setText(this.options.title);
		this.contentEl.addClass("vk-confirm");
		this.contentEl.createEl("p", { text: this.options.body });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => {
				button.setButtonText(this.options.confirmLabel).onClick(() => {
					this.confirmed = true;
					this.close();
				});
				if (this.options.warning) button.setDestructive().setCta();
				else button.setCta();
				window.setTimeout(() => button.buttonEl.focus(), 0);
			});
	}

	override onClose() {
		this.contentEl.empty();
		this.resolve(this.confirmed);
	}
}

/** Asks the user to confirm a bulk or destructive action. */
export function confirmAction(app: App, options: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, options, resolve).open());
}

/** The session's AI calls: purpose, model, tokens and cost. */
export class CostLogModal extends Modal {
	constructor(
		app: App,
		private readonly entries: CostEntry[],
	) {
		super(app);
	}

	override onOpen() {
		this.titleEl.setText("AI cost this session");
		this.modalEl.addClass("vk-cost-modal");
		const total = this.entries.reduce((sum, entry) => sum + entry.cost, 0);
		const runs = groupCalls(this.entries).length;
		const unpriced = this.entries.some((entry) => entry.pricing === "unpriced");
		this.contentEl.createEl("p", {
			cls: "vk-cost-total",
			text: `${preciseCost(total)}${unpriced ? " plus calls with unknown prices" : ""} across ${this.entries.length} ${this.entries.length === 1 ? "call" : "calls"} in ${runs} ${runs === 1 ? "run" : "runs"}.`,
		});
		if (this.entries.length === 0) {
			this.contentEl.createEl("p", { cls: "vk-faint", text: "Nothing yet. AI only runs when you click something." });
			return;
		}
		const table = this.contentEl.createEl("table", { cls: "vk-cost-table" });
		const head = table.createEl("thead").createEl("tr");
		for (const label of ["Time", "Purpose", "Model", "Tokens in / out", "Cost"]) head.createEl("th", { text: label });
		const body = table.createEl("tbody");
		for (const group of groupCalls(this.entries).reverse()) {
			const row = body.createEl("tr");
			row.createEl("td", { text: new Date(group.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
			const purpose = row.createEl("td", { text: group.calls > 1 ? `${group.purpose} · ${group.calls} calls` : group.purpose });
			if (group.fallback) purpose.createSpan({ cls: "vk-cost-flag", text: "fallback" });
			if (group.error) purpose.createSpan({ cls: "vk-cost-flag is-error", text: "failed", attr: { title: group.error } });
			row.createEl("td", { cls: "vk-cost-model", text: group.model });
			row.createEl("td", { text: `${group.inputTokens.toLocaleString()} / ${group.outputTokens.toLocaleString()}` });
			row.createEl("td", { text: group.pricing === "free" ? "Free" : group.pricing === "unpriced" ? "Unknown" : preciseCost(group.cost) });
		}
	}

	override onClose() {
		this.contentEl.empty();
	}
}

interface CallGroup extends CostEntry {
	calls: number;
}

/** Folds bursts of identical calls (one lint run makes many Jev calls) into one row. */
function groupCalls(entries: CostEntry[]): CallGroup[] {
	const groups: CallGroup[] = [];
	for (const entry of entries) {
		const last = groups[groups.length - 1];
		if (last && last.purpose === entry.purpose && last.model === entry.model && last.pricing === entry.pricing && entry.at - last.at < 60_000) {
			last.calls++;
			last.inputTokens += entry.inputTokens;
			last.outputTokens += entry.outputTokens;
			last.cost += entry.cost;
			last.fallback = last.fallback || entry.fallback;
			last.error = last.error ?? entry.error;
		} else {
			groups.push({ ...entry, calls: 1 });
		}
	}
	return groups;
}

function preciseCost(dollars: number): string {
	return dollars >= 0.01 ? formatCost(dollars) : `$${dollars.toFixed(5)}`;
}

/** A small text prompt, used by "New rule from selection". */
export function promptText(app: App, options: { title: string; label: string; value: string; confirmLabel: string }): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new (class extends Modal {
			private result: string | null = null;
			override onOpen() {
				this.titleEl.setText(options.title);
				let value = options.value;
				new Setting(this.contentEl).setName(options.label).addText((text) => {
					text.setValue(value).onChange((next) => (value = next));
					text.inputEl.addClass("vk-prompt-input");
					text.inputEl.addEventListener("keydown", (event) => {
						if (event.key === "Enter") {
							this.result = value;
							this.close();
						}
					});
					window.setTimeout(() => text.inputEl.select(), 0);
				});
				new Setting(this.contentEl)
					.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
					.addButton((button) =>
						button
							.setButtonText(options.confirmLabel)
							.setCta()
							.onClick(() => {
								this.result = value;
								this.close();
							}),
					);
			}
			override onClose() {
				this.contentEl.empty();
				resolve(this.result);
			}
		})(app);
		modal.open();
	});
}
