import { isolateHistory } from "@codemirror/commands";
import { Annotation, Transaction, type ChangeDesc, type TransactionSpec } from "@codemirror/state";
import type { TextRange } from "../core/model/types";

/** User events Vikalp attaches to its own transactions. */
export const VIKALP_EVENT = {
	cycle: "vikalp.cycle",
	create: "vikalp.create",
	edit: "vikalp.edit",
	stash: "vikalp.stash",
	insert: "vikalp.insert",
	ghost: "vikalp.ghost",
	trim: "vikalp.trim",
	fix: "vikalp.fix",
} as const;

/** Marks transactions that load sidecar state, so they are not saved back or put in history. */
export const loadAnnotation = Annotation.define<boolean>();

export function isUserEdit(tr: Transaction): boolean {
	return (
		tr.isUserEvent("input") ||
		tr.isUserEvent("delete") ||
		tr.isUserEvent("move") ||
		tr.isUserEvent("undo") ||
		tr.isUserEvent("redo") ||
		tr.isUserEvent("vikalp")
	);
}

export function mapRange(range: TextRange, mapping: ChangeDesc): TextRange {
	return { from: mapping.mapPos(range.from, 1), to: mapping.mapPos(range.to, -1) };
}

export const noHistory = Transaction.addToHistory.of(false);

/** Keeps a Vikalp edit in its own undo step, never merged with typing around it. */
export function isolated(spec: TransactionSpec): TransactionSpec {
	const annotations = spec.annotations ? (Array.isArray(spec.annotations) ? spec.annotations : [spec.annotations]) : [];
	if (annotations.some((annotation) => annotation.type === Transaction.addToHistory)) return spec;
	return { ...spec, annotations: [...annotations, isolateHistory.of("full")] };
}
