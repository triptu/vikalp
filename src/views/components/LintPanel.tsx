import type { LintHitView, LintRunState } from "../../store/uiStore";
import type { LintActions } from "../context";
import { relativeTime } from "../format";
import { Icon } from "./Icon";

export interface LintPanelProps {
	hasNote: boolean;
	hits: LintHitView[];
	run: LintRunState;
	isCurrentNote: boolean;
	labRunning: string | null;
	actions: LintActions;
	now: number;
}

interface HitGroup {
	label: string;
	source: "rule" | "lab";
	severity: LintHitView["severity"];
	hits: LintHitView[];
}

const SEVERITY_ORDER = { error: 0, warning: 1, suggestion: 2 } as const;

function groupHits(hits: LintHitView[]): HitGroup[] {
	const groups = new Map<string, HitGroup>();
	for (const hit of hits) {
		const key = `${hit.source}:${hit.label}`;
		const group = groups.get(key) ?? { label: hit.label, source: hit.source, severity: hit.severity, hits: [] };
		group.hits.push(hit);
		if (SEVERITY_ORDER[hit.severity] < SEVERITY_ORDER[group.severity]) group.severity = hit.severity;
		groups.set(key, group);
	}
	return [...groups.values()].sort((a, b) => (a.source === b.source ? b.hits.length - a.hits.length : a.source === "lab" ? -1 : 1));
}

export function LintPanel({ hasNote, hits, run, isCurrentNote, labRunning, actions, now }: LintPanelProps) {
	if (!hasNote) {
		return (
			<div className="vk-panel vk-lint">
				<div className="vk-empty">
					<p>Open a note to lint it.</p>
				</div>
			</div>
		);
	}
	const documentHits = hits.filter((hit) => hit.scope === "document");
	const inlineHits = hits.filter((hit) => hit.scope !== "document");
	const groups = groupHits(inlineHits);
	const fixable = hits.filter((hit) => hit.suggestion !== undefined && hit.source === "lab");
	const running = isCurrentNote && run.running;
	const ranAt = isCurrentNote ? run.ranAt : null;

	return (
		<div className="vk-panel vk-lint">
			<div className="vk-lint-toolbar">
				<button className="mod-cta vk-run-button" onClick={actions.run} disabled={running}>
					{running ? <span className="vk-spinner" /> : <Icon name="scan-text" />}
					{running ? "Linting…" : "Run linter"}
				</button>
				{hits.length > 0 && (
					<button className="vk-small-button" onClick={actions.clear}>
						Clear
					</button>
				)}
			</div>
			<div className="vk-lint-summary">
				{hits.length === 0 ? (ranAt ? "No marks. Reads clean." : "Nothing run yet.") : `${hits.length} ${hits.length === 1 ? "mark" : "marks"}`}
				{ranAt && <span className="vk-faint"> · ran {relativeTime(ranAt, now)}</span>}
			</div>

			{running && run.judgmentTotal > 0 && (
				<div className="vk-progress" title="Judgment rules">
					<div className="vk-progress-label">
						Judgment rules {run.judgmentDone}/{run.judgmentTotal}
					</div>
					<div className="vk-progress-track">
						<div className="vk-progress-fill" style={{ width: `${(run.judgmentDone / Math.max(1, run.judgmentTotal)) * 100}%` }} />
					</div>
				</div>
			)}
			{labRunning && (
				<div className="vk-lint-notice">
					<span className="vk-spinner" /> {labRunning}…
				</div>
			)}
			{isCurrentNote && run.notice && <div className="vk-lint-notice">{run.notice}</div>}

			{documentHits.length > 0 && (
				<div className="vk-document-hits">
					{documentHits.map((hit) => (
						<div key={hit.id} className={`vk-document-hit vk-severity-${hit.severity}`}>
							<div className="vk-hit-label">
								{hit.label}
								{hit.source === "lab" && <span className="vk-ai-badge">AI</span>}
							</div>
							<div className="vk-hit-message">{hit.message}</div>
							<button className="clickable-icon vk-hit-ignore" aria-label="Ignore" onClick={() => actions.ignore(hit.id)}>
								<Icon name="x" />
							</button>
						</div>
					))}
				</div>
			)}

			{fixable.length > 1 && (
				<div className="vk-fix-all">
					<button className="vk-small-button" onClick={actions.applyAllFixes}>
						Apply all {fixable.length} fixes…
					</button>
				</div>
			)}

			<div className="vk-hit-groups">
				{groups.map((group) => (
					<details key={`${group.source}:${group.label}`} className={`vk-hit-group vk-severity-${group.severity}`} open>
						<summary>
							<span className={`vk-severity-chip vk-severity-${group.severity}`} />
							<span className="vk-hit-group-label">{group.label}</span>
							{group.source === "lab" && <span className="vk-ai-badge">AI</span>}
							<span className="vk-hit-count">{group.hits.length}</span>
						</summary>
						<ul>
							{group.hits.map((hit) => (
								<li key={hit.id} className="vk-hit" onClick={() => actions.jumpTo(hit.id)}>
									<div className="vk-hit-excerpt">{truncate(hit.excerpt, 140)}</div>
									<div className="vk-hit-message">{hit.message}</div>
									{hit.suggestion !== undefined && (
										<div className="vk-hit-fix">
											<span className="vk-faint">Fix:</span> {hit.suggestion || "(delete)"}
										</div>
									)}
									<div className="vk-hit-actions">
										{hit.suggestion !== undefined && (
											<button
												className="vk-small-button"
												onClick={(event) => {
													event.stopPropagation();
													actions.applyFix(hit.id);
												}}
											>
												Apply
											</button>
										)}
										<button
											className="vk-small-button"
											onClick={(event) => {
												event.stopPropagation();
												actions.ignore(hit.id);
											}}
										>
											Ignore
										</button>
									</div>
								</li>
							))}
						</ul>
					</details>
				))}
			</div>

			{isCurrentNote && run.ruleErrors.length > 0 && (
				<div className="vk-rule-errors">
					<div className="vk-section-heading">Rule file problems</div>
					{run.ruleErrors.map((error) => (
						<div key={error} className="vk-rule-error">
							{error}
						</div>
					))}
				</div>
			)}

			<div className="vk-panel-footer vk-lint-footer">
				<button className="vk-link-button" onClick={actions.openRulesFolder}>
					Open rules folder
				</button>
				<span className="vk-faint">·</span>
				<button className="vk-link-button" onClick={actions.reloadRules}>
					Reload rules
				</button>
			</div>
		</div>
	);
}

function truncate(text: string, length: number): string {
	const flat = text.replace(/\s+/g, " ");
	return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}
