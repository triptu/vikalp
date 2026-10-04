import type { Extension } from "@codemirror/state";
import { ghosts, lintMarks, trimProposals } from "./collections";
import { vikalpDecorations } from "./decorations";
import { vikalpHost, type VikalpHost } from "./host";
import { vikalpInteraction } from "./interaction";
import { flashField, noteModeField, overflowField } from "./noteFields";
import { spansField } from "./spansField";

/** Every CodeMirror extension Vikalp needs, registered once per plugin. */
export function vikalpEditorExtension(host: VikalpHost): Extension[] {
	return [
		vikalpHost.of(host),
		spansField,
		ghosts.extensions,
		lintMarks.extensions,
		trimProposals.extensions,
		overflowField,
		noteModeField,
		flashField,
		vikalpDecorations,
		vikalpInteraction,
	];
}
