import type { SpanUnit } from "../../core/model/types";
import type { SpanView } from "../../store/uiStore";
import { useViewContext, type AlternativesActions } from "../context";
import { useStoreSlice } from "./useStore";

export interface AlternativesPanelModel {
	hasNote: boolean;
	span: SpanView | null;
	activeUnit: SpanUnit | null;
	aiPending: boolean;
	unplaced: SpanView[];
	hasApiKey: boolean;
	actions: AlternativesActions;
	modelLabel: string;
}

/** Everything the Alternatives panel shows, plus the actions it can take. */
export function useAlternativesPanel(): AlternativesPanelModel {
	const { store, alternatives, modelLabel } = useViewContext();
	const slice = useStoreSlice(store, (state) => ({
		note: state.note,
		panelSpanId: state.panelSpanId,
		aiPendingSpans: state.aiPendingSpans,
		hasApiKey: state.hasApiKey,
		modelMode: state.modelMode,
	}));
	const span = slice.note?.spans.find((candidate) => candidate.id === slice.panelSpanId && !candidate.orphaned) ?? null;
	return {
		hasNote: slice.note !== null,
		span,
		activeUnit: span?.unit ?? null,
		aiPending: span ? slice.aiPendingSpans.includes(span.id) : false,
		unplaced: slice.note?.spans.filter((candidate) => candidate.orphaned) ?? [],
		hasApiKey: slice.hasApiKey,
		actions: alternatives,
		modelLabel: modelLabel(slice.modelMode),
	};
}
