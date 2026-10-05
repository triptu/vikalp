import { LAB_PASSES, SPOTS_PASS, TRIM_LEVELS } from "../../core/ai/passes";
import type { ModelMode } from "../../core/settings";
import type { LabPassState, TrimState } from "../../store/uiStore";
import type { LabActions } from "../context";
import { formatCost } from "../format";
import { Icon } from "./Icon";

const MODES: Array<{ mode: ModelMode; label: string }> = [
	{ mode: "lite", label: "Lite" },
	{ mode: "medium", label: "Medium" },
	{ mode: "heavy", label: "Heavy" },
];

export interface LabPopoverProps {
	modelMode: ModelMode;
	modelId: string;
	hasApiKey: boolean;
	hasNote: boolean;
	lab: LabPassState;
	trim: TrimState;
	sessionCost: number;
	markCount: number;
	actions: LabActions;
}

export function LabPopover({ modelMode, modelId, hasApiKey, hasNote, lab, trim, sessionCost, markCount, actions }: LabPopoverProps) {
	const disabled = !hasApiKey || !hasNote;
	const busy = lab.runningPass !== null;
	return (
		<div className="vk-lab" role="dialog" aria-label="The Lab">
			<header className="vk-lab-header">
				<span className="vk-lab-title">The Lab</span>
				<div className="vk-segmented vk-lab-mode" role="radiogroup" aria-label="Model" title={modelId}>
					{MODES.map(({ mode, label }) => (
						<button
							key={mode}
							role="radio"
							aria-checked={modelMode === mode}
							className={`vk-segment${modelMode === mode ? " is-active" : ""}`}
							onClick={() => actions.setModelMode(mode)}
						>
							{label}
						</button>
					))}
				</div>
			</header>

			{!hasApiKey && (
				<div className="vk-lab-warning">
					Add an OpenRouter key to use the Lab.{" "}
					<button className="vk-inline-action" onClick={actions.openSettings}>
						Open settings
					</button>
				</div>
			)}

			<button
				className={`vk-lab-pass vk-lab-spots${lab.runningPass === SPOTS_PASS ? " is-running" : ""}`}
				disabled={disabled || (busy && lab.runningPass !== SPOTS_PASS)}
				onClick={actions.findSpots}
				title="Picks up to 8 words or lines and adds AI versions to each. The note doesn't change until you pick one."
			>
				<Icon name="wand-sparkles" />
				<span className="vk-lab-pass-label">Find words worth playing with</span>
				{lab.runningPass === SPOTS_PASS && <span className="vk-spinner" />}
			</button>

			<section className="vk-lab-section">
				<div className="vk-lab-section-title">Mark</div>
				<div className="vk-lab-passes">
					{LAB_PASSES.map((pass) => {
						const running = lab.runningPass === pass.id;
						return (
							<button
								key={pass.id}
								className={`vk-lab-pass${running ? " is-running" : ""}`}
								disabled={disabled || (busy && !running)}
								onClick={() => actions.runPass(pass.id)}
								title={pass.description}
							>
								<span className="vk-lab-pass-label">{pass.short}</span>
								{running && <span className="vk-spinner" />}
							</button>
						);
					})}
				</div>
				{lab.message && <div className="vk-lab-status">{lab.message}</div>}
			</section>

			<section className="vk-lab-section">
				<div className="vk-lab-section-title">Trim</div>
				<div className="vk-segmented vk-trim-levels" role="radiogroup" aria-label="Trim level">
					{TRIM_LEVELS.map((level) => (
						<button
							key={level.id}
							role="radio"
							aria-checked={trim.level === level.id}
							className={`vk-segment${trim.level === level.id ? " is-active" : ""}`}
							disabled={disabled || trim.status === "reading"}
							onClick={() => actions.setTrimLevel(level.id)}
							title={level.target > 0 ? `Propose cutting about ${Math.round(level.target * 100)}%. Nothing is deleted yet.` : "No cuts"}
						>
							<span className="vk-segment-name">{level.name}</span>
							{level.target > 0 && <span className="vk-segment-detail">{Math.round(level.target * 100)}%</span>}
						</button>
					))}
				</div>
			</section>

			<footer className="vk-lab-footer">
				<span className="vk-lab-keys">
					<kbd>⌘J</kbd> alternatives · <kbd>⌘.</kbd> all actions
				</span>
				<span className="vk-lab-footer-end">
					<button className="vk-inline-action" onClick={actions.showCostLog} title="Show the cost log">
						{formatCost(sessionCost)}
					</button>
					<button
						className="clickable-icon"
						aria-label="More: clear marks, remove AI versions, settings"
						onClick={(event) => actions.openMenu(event.currentTarget as HTMLElement, markCount)}
					>
						<Icon name="more-horizontal" />
					</button>
				</span>
			</footer>
		</div>
	);
}
