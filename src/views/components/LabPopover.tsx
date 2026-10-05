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
	return (
		<div className="vk-lab" role="dialog" aria-label="The Lab">
			<div className="vk-lab-header">
				<span className="vk-lab-title">The Lab</span>
				<span className="vk-lab-subtitle">AI marks and trims. It never writes for you.</span>
			</div>

			<section className="vk-lab-section">
				<div className="vk-lab-section-title">Model</div>
				<div className="vk-segmented" role="radiogroup" aria-label="Model mode">
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
				<div className="vk-lab-model-id">{modelId}</div>
			</section>

			{!hasApiKey && (
				<div className="vk-lab-warning">
					Add an OpenRouter API key to use the Lab.{" "}
					<button className="vk-link-button" onClick={actions.openSettings}>
						Open settings
					</button>
				</div>
			)}

			<section className="vk-lab-section">
				<div className="vk-lab-section-title">Alternatives</div>
				<div className="vk-lab-passes">
					<button
						className={`vk-lab-pass${lab.runningPass === SPOTS_PASS ? " is-running" : ""}`}
						disabled={disabled || (lab.runningPass !== null && lab.runningPass !== SPOTS_PASS)}
						onClick={actions.findSpots}
						title="Picks up to 8 words or lines in the note (or the selection) and adds AI versions to each. The note doesn't change until you pick one."
					>
						<span className="vk-lab-pass-label">Find words worth playing with</span>
						{lab.runningPass === SPOTS_PASS && <span className="vk-spinner" />}
					</button>
				</div>
			</section>

			<section className="vk-lab-section">
				<div className="vk-lab-section-title">Mark</div>
				<div className="vk-lab-passes">
					{LAB_PASSES.map((pass) => {
						const running = lab.runningPass === pass.id;
						return (
							<button
								key={pass.id}
								className={`vk-lab-pass${running ? " is-running" : ""}`}
								disabled={disabled || (lab.runningPass !== null && !running)}
								onClick={() => actions.runPass(pass.id)}
								title={pass.description}
							>
								<span className="vk-lab-pass-label">{pass.label}</span>
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
						>
							<span className="vk-segment-name">{level.name}</span>
							{level.target > 0 && <span className="vk-segment-detail">~{Math.round(level.target * 100)}%</span>}
						</button>
					))}
				</div>
				<div className="vk-lab-hint">{trim.status === "idle" ? "Pick a level and the model proposes cuts. Nothing is deleted yet." : "Struck words would go. Click one to keep it."}</div>
			</section>

			<div className="vk-lab-footer">
				<div className="vk-lab-footer-row">
					<button className="vk-link-button" onClick={actions.clearMarks} disabled={markCount === 0}>
						Clear Lab marks{markCount > 0 ? ` (${markCount})` : ""}
					</button>
					<button className="vk-link-button" onClick={actions.removeAllAiVersions} disabled={!hasNote} title="Removes every AI version in this note. Your own versions stay.">
						Remove AI versions
					</button>
				</div>
				<div className="vk-lab-footer-row">
					<button className="vk-link-button" onClick={actions.showCostLog} title="Show the cost log">
						{formatCost(sessionCost)} spent this session
					</button>
					<button className="clickable-icon" aria-label="Vikalp settings" onClick={actions.openSettings}>
						<Icon name="settings" />
					</button>
				</div>
			</div>
		</div>
	);
}
