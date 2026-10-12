import type { Setting } from "obsidian";
import type { ModelChoice } from "../core/modelChoices";

const CUSTOM = "custom";

export interface ModelPickerOptions {
	/** The provider's own models, listed first. */
	choices: ModelChoice[];
	/** Suggested open models, listed in their own group. */
	openModels: ModelChoice[];
	/** The model set now. Shown even when it isn't one of the choices. */
	current: string;
	onPick: (id: string) => void;
	/** The writer chose "Custom…" to type a model id. */
	onCustom: () => void;
}

/** A native dropdown of suggested models, ending with "Custom…". */
export function addModelPicker(setting: Setting, { choices, openModels, current, onPick, onCustom }: ModelPickerOptions) {
	setting.addDropdown((dropdown) => {
		const listed = [...choices, ...openModels].some((choice) => choice.id === current);
		if (current && !listed) dropdown.addOption(current, current);
		for (const choice of choices) dropdown.addOption(choice.id, choice.name);
		if (openModels.length > 0) {
			const group = dropdown.selectEl.createEl("optgroup", { attr: { label: "Open models" } });
			for (const choice of openModels) group.createEl("option", { text: choice.name, value: choice.id });
		}
		dropdown.addOption(CUSTOM, "Custom…");
		dropdown.setValue(current).onChange((value) => (value === CUSTOM ? onCustom() : onPick(value)));
	});
}
