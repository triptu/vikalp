import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { sessionCost } from "../store/uiStore";
import { AlternativesPanel } from "./components/AlternativesPanel";
import { IconContext, type IconRenderer } from "./components/Icon";
import { LabPopover } from "./components/LabPopover";
import { LintPanel } from "./components/LintPanel";
import { OverflowPanel } from "./components/OverflowPanel";
import { TrimBar } from "./components/TrimBar";
import { ViewContext, useViewContext, type VikalpViewContext } from "./context";
import { useAlternativesPanel } from "./hooks/useAlternativesPanel";
import { useStoreSlice } from "./hooks/useStore";

export function Providers({ context, icon, children }: { context: VikalpViewContext; icon: IconRenderer; children?: ComponentChildren }) {
	return (
		<ViewContext.Provider value={context}>
			<IconContext.Provider value={icon}>{children}</IconContext.Provider>
		</ViewContext.Provider>
	);
}

/** Re-renders every minute so relative times stay fresh. */
function useNow(): number {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);
	return now;
}

export function AlternativesContainer({ focusRequest }: { focusRequest: number }) {
	return <AlternativesPanel model={useAlternativesPanel()} focusRequest={focusRequest} />;
}

export function OverflowContainer() {
	const { store, overflow } = useViewContext();
	const now = useNow();
	const slice = useStoreSlice(store, (state) => ({
		hasNote: state.note !== null,
		blocks: state.note?.overflow ?? [],
		hasPanelSpan: state.panelSpanId !== null,
	}));
	return <OverflowPanel {...slice} actions={overflow} now={now} />;
}

export function LintContainer() {
	const { store, lint } = useViewContext();
	const now = useNow();
	const slice = useStoreSlice(store, (state) => ({
		hasNote: state.note !== null,
		hits: state.note?.lintHits ?? [],
		run: state.lint,
		isCurrentNote: state.lint.notePath !== null && state.lint.notePath === state.note?.path,
		labRunning: state.lab.runningPass,
	}));
	return <LintPanel {...slice} actions={lint} now={now} />;
}

export function LabContainer({ modelIdFor }: { modelIdFor: (mode: string) => string }) {
	const { store, lab } = useViewContext();
	const slice = useStoreSlice(store, (state) => ({
		modelMode: state.modelMode,
		hasApiKey: state.hasApiKey,
		hasNote: state.note !== null,
		lab: state.lab,
		trim: state.trim,
		sessionCost: sessionCost(state),
		markCount: state.note?.lintHits.filter((hit) => hit.source === "lab").length ?? 0,
	}));
	return <LabPopover {...slice} modelId={modelIdFor(slice.modelMode)} actions={lab} />;
}

export function TrimBarContainer() {
	const { store, lab, trimPrimary } = useViewContext();
	const slice = useStoreSlice(store, (state) => ({
		trim: state.trim,
		proposalCount: state.note?.proposalCount ?? 0,
		proposalWords: state.note?.proposalWords ?? 0,
		visible: state.trim.status !== "idle" && state.trim.notePath === state.note?.path,
	}));
	if (!slice.visible) return null;
	return <TrimBar trim={slice.trim} proposalCount={slice.proposalCount} proposalWords={slice.proposalWords} primary={trimPrimary()} actions={lab} />;
}
