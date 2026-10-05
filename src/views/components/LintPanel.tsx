import type { LintPanelModel } from "../hooks/useLintPanel";
import { formatCost, relativeTime } from "../format";
import { Icon } from "./Icon";

export function LintPanel({ model, now }: { model: LintPanelModel; now: number }) {
	const { hasNote, total, documentHits, groups, fixableCount, running, ranAt, run, isCurrentNote, labRunning, actions } = model;
	if (!hasNote) {
		return (
			<div className="vk-panel vk-lint-panel">
				<div className="vk-empty">
					<p>Open a note to lint it.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="vk-panel vk-lint-panel">
			<div className="vk-lint-toolbar">
				<button className="vk-toolbar-button" onClick={actions.run} disabled={running}>
					{running ? <span className="vk-spinner" /> : <Icon name="scan-text" />}
					{running ? "Linting…" : "Run linter"}
				</button>
				{total > 0 && (
					<button className="vk-toolbar-button" onClick={actions.clear}>
						Clear
					</button>
				)}
			</div>
			<div className="vk-lint-summary">
				{running ? (
					`${total} ${total === 1 ? "mark" : "marks"} so far`
				) : total === 0 ? (
					ranAt ? (
						"No marks. Reads clean."
					) : (
						<>
							Not run on this note yet.
							<div className="vk-lint-hint">Local rules are free. Judgment rules ask AI and cost a little.</div>
						</>
					)
				) : (
					`${total} ${total === 1 ? "mark" : "marks"}`
				)}
				{!running && ranAt && <span className="vk-quiet"> · ran {relativeTime(ranAt, now)}</span>}
				{!running && ranAt && run.cost > 0 && <span className="vk-quiet"> · {formatCost(run.cost)}</span>}
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
					<div className="vk-section-heading">Whole note</div>
					{documentHits.map((hit) => (
						<div key={hit.id} className="vk-document-hit">
							<div className="vk-document-hit-heading">
								<span className={`vk-severity-chip vk-severity-${hit.severity}`} />
								<span className="vk-hit-group-label">{hit.label}</span>
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
					<button className="vk-compact-button" onClick={actions.applyAllFixes}>
						Apply all {fixableCount} fixes…
					</button>
				</div>
			)}

			<div className="vk-hit-groups">
				{groups.map((group) => (
					<details key={group.key} className={`vk-hit-group vk-severity-${group.severity}`} open>
						<summary>
							<Icon name="chevron-right" className="vk-disclosure" />
							<span className={`vk-severity-chip vk-severity-${group.severity}`} />
							<span className="vk-hit-group-label">{group.label}</span>
							{group.byAi && <span className="vk-ai-badge" title="Some of these marks were made by a model">AI</span>}
							<span className="vk-hit-count">{group.hits.length}</span>
						</summary>
						<ul>
							{group.hits.map((hit) => (
								<li
									key={hit.id}
									className="vk-hit"
									tabIndex={0}
									onClick={() => actions.jumpTo(hit.id)}
									onKeyDown={(event) => {
										if (event.key === "Enter" && event.target === event.currentTarget) actions.jumpTo(hit.id);
									}}
								>
									<div className="vk-hit-excerpt">{truncate(hit.excerpt, 140)}</div>
									{hit.suggestion !== undefined && (
										<div className="vk-hit-fix">
											<span className="vk-quiet">Fix:</span> {hit.suggestion || "delete it"}
										</div>
									)}
									<div className="vk-hit-message">
										{hit.message}
										{hit.suggestion !== undefined && (
											<>
												<span className="vk-quiet"> · </span>
												<button
													className="vk-inline-action"
													onClick={(event) => {
														event.stopPropagation();
														actions.applyFix(hit.id);
													}}
												>
													Apply
												</button>
											</>
										)}
										<span className="vk-quiet"> · </span>
										<button
											className="vk-inline-action"
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
