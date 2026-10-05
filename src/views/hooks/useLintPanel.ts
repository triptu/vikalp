import type { Severity } from "../../core/model/types";
import { runningLabel } from "../../core/ai/passes";
import type { LintHitView } from "../../store/uiStore";
import { useViewContext } from "../context";
import { useStoreSlice } from "./useStore";

export interface HitGroup {
	key: string;
	label: string;
	byAi: boolean;
	severity: Severity;
	hits: LintHitView[];
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, suggestion: 2 };

/** Groups inline hits by label. Lab groups come first, then the biggest groups. */
export function groupHits(hits: LintHitView[]): HitGroup[] {
	const groups = new Map<string, HitGroup & { source: string }>();
	for (const hit of hits) {
		const key = `${hit.source}:${hit.label}`;
		const group = groups.get(key) ?? { key, label: hit.label, source: hit.source, byAi: false, severity: hit.severity, hits: [] };
		group.hits.push(hit);
		if (hit.byAi) group.byAi = true;
		if (SEVERITY_ORDER[hit.severity] < SEVERITY_ORDER[group.severity]) group.severity = hit.severity;
		groups.set(key, group);
	}
	return [...groups.values()].sort((a, b) => (a.source === b.source ? b.hits.length - a.hits.length : a.source === "lab" ? -1 : 1));
}

/** The Lint panel's data: hits split by scope and grouped, the run state, and its actions. */
export function useLintPanel() {
	const { store, lint } = useViewContext();
	const slice = useStoreSlice(store, (state) => ({
		hasNote: state.note !== null,
		hits: state.note?.lintHits ?? [],
		run: state.lint,
		isCurrentNote: state.lint.notePath !== null && state.lint.notePath === state.note?.path,
		labRunning: state.lab.runningPass,
	}));
	return {
		hasNote: slice.hasNote,
		total: slice.hits.length,
		documentHits: slice.hits.filter((hit) => hit.scope === "document"),
		groups: groupHits(slice.hits.filter((hit) => hit.scope !== "document")),
		fixableCount: slice.hits.filter((hit) => hit.suggestion !== undefined && hit.source === "lab").length,
		running: slice.isCurrentNote && slice.run.running,
		ranAt: slice.isCurrentNote ? slice.run.ranAt : null,
		run: slice.run,
		isCurrentNote: slice.isCurrentNote,
		labRunning: slice.labRunning ? runningLabel(slice.labRunning) : null,
		actions: lint,
	};
}

export type LintPanelModel = ReturnType<typeof useLintPanel>;
