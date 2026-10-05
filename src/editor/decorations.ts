import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { activeIndex } from "../core/model/span";
import type { TextRange } from "../core/model/types";
import { paragraphAround } from "../core/text/segment";
import { ghosts, lintMarks, trimProposals } from "./collections";
import { flashField, noteModeField } from "./noteFields";
import { listSpans, spansField } from "./spansField";
import { DotRowWidget, ParagraphDotsWidget } from "./widgets";

/** The span under the mouse, and whether arrow keys may cycle it. */
export interface HoverState {
	spanId: string | null;
	armed: boolean;
}

export const setHover = StateEffect.define<HoverState>();

export const hoverField = StateField.define<HoverState>({
	create: () => ({ spanId: null, armed: false }),
	update(value, tr) {
		for (const effect of tr.effects) if (effect.is(setHover)) return effect.value;
		return value;
	},
});

function lineDecorations(state: EditorState, range: TextRange, decoration: Decoration): Range<Decoration>[] {
	const found: Range<Decoration>[] = [];
	const firstLine = state.doc.lineAt(range.from).number;
	const lastLine = state.doc.lineAt(Math.max(range.from, range.to)).number;
	for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) found.push(decoration.range(state.doc.line(lineNumber).from));
	return found;
}

function spanDecorations(state: EditorState): Range<Decoration>[] {
	const mode = state.field(noteModeField);
	if (!mode.markersOn || mode.readThrough) return [];
	const hover = state.field(hoverField);
	const flashing = state.field(flashField);
	const found: Range<Decoration>[] = [];
	for (const { meta, range } of listSpans(state)) {
		if (!range || range.to <= range.from) continue;
		if (meta.versions.length < 2 && meta.id !== mode.focusedSpan) continue;
		const dots = { count: meta.versions.length, active: activeIndex(meta), hasNote: Boolean(meta.note?.trim()) };
		const classes = ["vk-span", `vk-span-${meta.unit}`];
		if (hover.spanId === meta.id) classes.push("is-hovered");
		if (flashing === meta.id) classes.push("vk-swapped");
		if (dots.active !== 0) classes.push("is-variant");
		const attributes = { "data-vk-span": meta.id };
		found.push(Decoration.mark({ class: classes.join(" "), attributes }).range(range.from, range.to));
		if (meta.unit === "paragraph") {
			const lineClass = hover.spanId === meta.id ? "vk-span-para is-hovered" : "vk-span-para";
			found.push(...lineDecorations(state, range, Decoration.line({ class: lineClass })));
			found.push(Decoration.widget({ widget: new ParagraphDotsWidget(meta.id, dots), side: -1 }).range(state.doc.lineAt(range.from).from));
		} else {
			found.push(Decoration.widget({ widget: new DotRowWidget(meta.id, dots), side: 1 }).range(range.to));
		}
	}
	return found;
}

function ghostDecorations(state: EditorState): Range<Decoration>[] {
	return ghosts.list(state).map(({ range }) => Decoration.mark({ class: "vk-ghost" }).range(range.from, range.to));
}

function lintDecorations(state: EditorState): Range<Decoration>[] {
	if (state.field(noteModeField).readThrough) return [];
	const found: Range<Decoration>[] = [];
	for (const { meta, range } of lintMarks.list(state)) {
		if (meta.scope === "document") continue;
		if (meta.scope === "paragraph") {
			found.push(...lineDecorations(state, range, Decoration.line({ class: `vk-lint-para vk-lint-para-${meta.severity}` })));
			continue;
		}
		const sourceClass = meta.source === "lab" ? " vk-lint-lab" : meta.judgment ? " vk-lint-ai" : "";
		found.push(
			Decoration.mark({ class: `vk-lint vk-lint-${meta.severity}${sourceClass}`, attributes: { "data-vk-lint": meta.id } }).range(range.from, range.to),
		);
	}
	return found;
}

function proposalDecorations(state: EditorState): Range<Decoration>[] {
	const mode = state.field(noteModeField);
	if (mode.readThrough) return [];
	return trimProposals.list(state).map(({ meta, range }) =>
		Decoration.mark({
			class: `vk-proposal${meta.id === mode.walkProposal ? " is-current" : ""}${meta.risky ? " is-risky" : ""}`,
			attributes: {
				"data-vk-proposal": meta.id,
				title: `${meta.why ? `Would cut: ${meta.why}.` : "Would cut."}${meta.risky ? " This cut may leave a broken sentence." : ""} Click to keep.`,
			},
		}).range(range.from, range.to),
	);
}

function focusDecorations(state: EditorState): Range<Decoration>[] {
	const { focusedSpan, readThrough } = state.field(noteModeField);
	if (!focusedSpan || readThrough) return [];
	const range = listSpans(state).find((span) => span.meta.id === focusedSpan)?.range;
	if (!range) return [];
	const paragraph = paragraphAround(state.doc.toString(), range) ?? range;
	return lineDecorations(state, paragraph, Decoration.line({ class: "vk-focus-line" }));
}

function buildDecorations(state: EditorState): DecorationSet {
	const all = [...ghostDecorations(state), ...lintDecorations(state), ...proposalDecorations(state), ...spanDecorations(state), ...focusDecorations(state)];
	return Decoration.set(all, true);
}

export const vikalpDecorations = [
	hoverField,
	EditorView.decorations.compute([spansField, ghosts.field, lintMarks.field, trimProposals.field, noteModeField, flashField, hoverField], buildDecorations),
	EditorView.editorAttributes.compute([noteModeField, trimProposals.field], (state) => {
		const mode = state.field(noteModeField);
		const classes = ["vk-editor"];
		if (trimProposals.list(state).length > 0 && !mode.readThrough) classes.push("vk-trimming");
		if (mode.focusedSpan && !mode.readThrough) classes.push("vk-dim-others");
		if (mode.readThrough) classes.push("vk-read-through");
		if (mode.markersOn) classes.push("vk-markers-on");
		return { class: classes.join(" ") };
	}),
];
