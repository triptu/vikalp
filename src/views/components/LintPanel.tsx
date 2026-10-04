import type { LintPanelModel } from "../hooks/useLintPanel";
import { formatCost, relativeTime } from "../format";
import { Icon } from "./Icon";

export function LintPanel({ model, now }: { model: LintPanelModel; now: number }) {
	const { hasNote, total, documentHits, groups, fixableCount, running, ranAt, run, isCurrentNote, labRunning, actions } = model;
	if (!hasNote) {
		return (
			<div className="vk-panel vk-lint">
				<div className="vk-empty">
					<p>Open a note to lint it.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="vk-panel vk-lint">
			<div className="vk-lint-toolbar">
				<button className="vk-run-button" onClick={actions.run} disabled={running}>
					{running ? <span className="vk-spinner" /> : <Icon name="scan-text" />}
					{running ? "Linting…" : "Run linter"}
				</button>
				{total > 0 && (
					<button className="vk-small-button" onClick={actions.clear}>
						Clear
					</button>
				)}
			</div>
			<div className="vk-lint-summary">
				{total === 0 ? (ranAt ? "No marks. Reads clean." : "Nothing run yet.") : `${total} ${total === 1 ? "mark" : "marks"}`}
				{ranAt && <span className="vk-faint"> · ran {relativeTime(ranAt, now)}</span>}
				{ranAt && run.cost > 0 && <span className="vk-faint"> · {formatCost(run.cost)}</span>}
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
								{hit.byAi && <span className="vk-ai-badge">AI</span>}
							</div>
							<div className="vk-hit-message">{hit.message}</div>
							<button className="clickable-icon vk-hit-ignore" aria-label="Ignore" onClick={() => actions.ignore(hit.id)}>
								<Icon name="x" />
							</button>
						</div>
					))}
				</div>
			)}

			{fixableCount > 1 && (
				<div className="vk-fix-all">
					<button className="vk-small-button" onClick={actions.applyAllFixes}>
						Apply all {fixableCount} fixes…
					</button>
				</div>
			)}

			<div className="vk-hit-groups">
				{groups.map((group) => (
					<details key={group.key} className={`vk-hit-group vk-severity-${group.severity}`} open>
						<summary>
							<span className={`vk-severity-chip vk-severity-${group.severity}`} />
							<span className="vk-hit-group-label">{group.label}</span>
							{group.byAi && <span className="vk-ai-badge" title="Some of these marks were made by a model">AI</span>}
							<span className="vk-hit-count">{group.hits.length}</span>
						</summary>
						<ul>
							{group.hits.map((hit) => (
								<li key={hit.id} className="vk-hit" onClick={() => actions.jumpTo(hit.id)}>
									<div className="vk-hit-excerpt">{truncate(hit.excerpt, 140)}</div>
									<div className="vk-hit-message">
										{hit.message}
										{hit.byAi && hit.source === "rule" && <span className="vk-hit-by"> · {hit.model ? shortModel(hit.model) : "AI"}</span>}
									</div>
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

function shortModel(model: string): string {
	return model.replace(/^[^/]+\//, "");
}

function truncate(text: string, length: number): string {
	const flat = text.replace(/\s+/g, " ");
	return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}
