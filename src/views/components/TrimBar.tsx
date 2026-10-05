import { trimLevel } from "../../core/ai/passes";
import type { TrimState } from "../../store/uiStore";
import type { LabActions } from "../context";
import { percentChange } from "../format";

export interface TrimBarProps {
	trim: TrimState;
	proposalCount: number;
	proposalWords: number;
	walkReason: string | null;
	riskyCount: number;
	primary: "ghost" | "cut";
	actions: LabActions;
}

/** The status bar shown over the note while a trim proposal is open. */
export function TrimBar({ trim, proposalCount, proposalWords, walkReason, riskyCount, primary, actions }: TrimBarProps) {
	const level = trimLevel(trim.level);
	const after = trim.beforeWords - proposalWords;

	if (trim.status === "reading") {
		return (
			<div className="vk-trim-bar" role="status">
				<div className="vk-trim-line">
					<span className="vk-trim-title">{level.label}</span>
					<span className="vk-trim-reading">
						<span className="vk-spinner" /> Reading the note…
					</span>
				</div>
			</div>
		);
	}

	if (trim.status === "error") {
		return (
			<div className="vk-trim-bar is-error" role="status">
				<div className="vk-trim-line">
					<span className="vk-trim-title">{level.label}</span>
					<span className="vk-trim-message">{trim.message}</span>
				</div>
				<div className="vk-trim-actions">
					<button className="mod-cta" onClick={() => actions.setTrimLevel(trim.level)}>
						Try again
					</button>
					<button className="vk-trim-secondary" onClick={actions.finishTrim}>
						Close
					</button>
				</div>
			</div>
		);
	}

	if (trim.walking) {
		return (
			<div className="vk-trim-bar" role="status">
				<div className="vk-trim-line">
					<span className="vk-trim-title">Walk through</span>
					<span className="vk-trim-numbers">{proposalCount} left</span>
				</div>
				{walkReason && <div className="vk-trim-hint">Would cut: {walkReason}</div>}
				<div className="vk-trim-actions">
					<button onClick={() => actions.walkStep("keep")}>
						Keep <kbd>K</kbd>
					</button>
					<button className="mod-cta" onClick={() => actions.walkStep("cut")}>
						Cut <kbd>C</kbd>
					</button>
					<button onClick={() => actions.walkStep("skip")}>
						Skip <kbd>S</kbd>
					</button>
					<button className="vk-trim-secondary" onClick={actions.stopWalking}>
						Stop
					</button>
				</div>
			</div>
		);
	}

	const ghostButton = (
		<button key="ghost" className={primary === "ghost" ? "mod-cta" : ""} onClick={actions.ghostCuts} disabled={proposalCount === 0}>
			Ghost the cuts
		</button>
	);
	const cutButton = (
		<button key="cut" className={primary === "cut" ? "mod-cta" : ""} onClick={actions.makeCuts} disabled={proposalCount === 0}>
			Make the cuts
		</button>
	);

	return (
		<div className="vk-trim-bar" role="status">
			<div className="vk-trim-line">
				<span className="vk-trim-title">{level.label}</span>
				<span className="vk-trim-numbers">
					{trim.beforeWords} → {after} words · {percentChange(trim.beforeWords, after)}
				</span>
				{trim.rejected > 0 && <span className="vk-trim-rejected">{trim.rejected} could not be placed</span>}
			</div>
			<div className="vk-trim-hint">
				{trim.message ?? (proposalCount > 0 ? "Struck words would go. Click one to keep it." : "Nothing left to cut at this level.")}
				{riskyCount > 0 && !trim.message && " Wavy red cuts may break their sentence."}
			</div>
			<div className="vk-trim-actions">
				{primary === "ghost" ? [ghostButton, cutButton] : [cutButton, ghostButton]}
				<button onClick={actions.walkThrough} disabled={proposalCount === 0}>
					Walk through
				</button>
				<button className="vk-trim-secondary" onClick={actions.finishTrim}>
					Done
				</button>
			</div>
		</div>
	);
}
