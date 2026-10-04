import { useEffect, useRef, useState } from "preact/hooks";
import type { SpanUnit } from "../../core/model/types";
import type { SpanView } from "../../store/uiStore";
import type { AlternativesPanelModel } from "../hooks/useAlternativesPanel";
import { Icon } from "./Icon";

const UNITS: Array<{ unit: SpanUnit; label: string }> = [
	{ unit: "word", label: "Word" },
	{ unit: "sentence", label: "Sentence" },
	{ unit: "paragraph", label: "Paragraph" },
];

const ASK_AI = "??";

export function AlternativesPanel({ model, focusRequest }: { model: AlternativesPanelModel; focusRequest: number }) {
	const { span, actions, unplaced } = model;
	const inputRef = useRef<HTMLInputElement>(null);
	const [draft, setDraft] = useState("");

	useEffect(() => {
		if (focusRequest > 0) inputRef.current?.focus();
	}, [focusRequest]);

	useEffect(() => setDraft(""), [span?.id]);

	const activeIndex = span ? Math.max(0, span.versions.findIndex((version) => version.id === span.activeVersion)) : 0;

	const step = (direction: number) => {
		if (!span || span.versions.length < 2) return;
		const next = span.versions[(activeIndex + direction + span.versions.length) % span.versions.length]!;
		actions.selectVersion(span.id, next.id);
	};

	const onInputKey = (event: KeyboardEvent) => {
		if (!span) return;
		if (event.key === "Enter" && !event.isComposing) {
			event.preventDefault();
			const text = draft.trim();
			if (text === ASK_AI) actions.askAi(span.id);
			else if (text) actions.addVersion(span.id, text);
			setDraft("");
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			step(-1);
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			step(1);
		} else if (event.key === "Escape") {
			event.preventDefault();
			actions.focusEditor();
		}
	};

	return (
		<div
			className="vk-panel vk-alternatives"
			onFocusIn={() => actions.setPanelFocused(true)}
			onFocusOut={(event) => {
				const next = event.relatedTarget as Node | null;
				if (!next || !(event.currentTarget as HTMLElement).contains(next)) actions.setPanelFocused(false);
			}}
		>
			<div className="vk-unit-tabs" role="tablist">
				{UNITS.map(({ unit, label }) => (
					<button
						key={unit}
						role="tab"
						aria-selected={model.activeUnit === unit}
						className={`vk-unit-tab${model.activeUnit === unit ? " is-active" : ""}`}
						onClick={() => actions.createForUnit(unit)}
						title={`Alternatives for the ${unit} at the cursor`}
					>
						{label}
					</button>
				))}
			</div>

			{span ? (
				<SpanEditor
					span={span}
					activeIndex={activeIndex}
					draft={draft}
					setDraft={setDraft}
					inputRef={inputRef}
					onInputKey={onInputKey}
					model={model}
				/>
			) : (
				<EmptyState hasNote={model.hasNote} />
			)}

			{unplaced.length > 0 && <UnplacedList spans={unplaced} model={model} />}

			<div className="vk-panel-footer">return adds · ?? asks AI · esc closes</div>
		</div>
	);
}

function SpanEditor({
	span,
	activeIndex,
	draft,
	setDraft,
	inputRef,
	onInputKey,
	model,
}: {
	span: SpanView;
	activeIndex: number;
	draft: string;
	setDraft: (text: string) => void;
	inputRef: { current: HTMLInputElement | null };
	onInputKey: (event: KeyboardEvent) => void;
	model: AlternativesPanelModel;
}) {
	const { actions } = model;
	const asksAi = draft.trim() === ASK_AI;
	const hasAi = span.versions.some((version) => version.source === "ai");
	return (
		<div className="vk-span-editor">
			<ul className="vk-version-list" role="listbox" aria-label="Versions">
				{span.versions.map((version, index) => {
					const isActive = index === activeIndex;
					const shownText = isActive && span.text !== null ? span.text : version.text;
					const provenance = version.source === "ai" ? `AI · ${version.model ?? "unknown model"}` : index === 0 ? "Original" : "You wrote this";
					return (
						<li
							key={version.id}
							role="option"
							aria-selected={isActive}
							className={`vk-version${isActive ? " is-active" : ""}${version.source === "ai" ? " is-ai" : ""}`}
							onClick={() => actions.selectVersion(span.id, version.id)}
							onContextMenu={(event) => {
								event.preventDefault();
								actions.deleteVersion(span.id, version.id);
							}}
							title={provenance}
						>
							<span className="vk-version-marker">{version.source === "ai" ? <Icon name="bot" className="vk-bot" /> : <span className="vk-bullet" />}</span>
							<span className={`vk-version-text${span.unit === "paragraph" ? " is-paragraph" : ""}`}>{shownText}</span>
							{index === 0 && span.versions.length > 1 && <span className="vk-version-tag">original</span>}
							<button
								className="vk-version-delete clickable-icon"
								aria-label="Delete this version"
								onClick={(event) => {
									event.stopPropagation();
									actions.deleteVersion(span.id, version.id);
								}}
							>
								<Icon name="x" />
							</button>
						</li>
					);
				})}
				{model.aiPending && (
					<li className="vk-version is-pending" aria-live="polite">
						<span className="vk-version-marker">
							<Icon name="bot" className="vk-bot" />
						</span>
						<span className="vk-version-text vk-asking">
							<span className="vk-asking-marks">??</span> asking {model.modelLabel}…
						</span>
					</li>
				)}
			</ul>

			<div className={`vk-version-input-row${asksAi ? " is-asking" : ""}`}>
				<span className="vk-version-marker">{asksAi ? <Icon name="bot" className="vk-bot" /> : <span className="vk-bullet is-hollow" />}</span>
				<input
					ref={inputRef}
					className="vk-version-input"
					type="text"
					value={draft}
					placeholder={span.versions.length < 2 ? "Type another version…" : "Add a version…"}
					onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
					onKeyDown={onInputKey}
					spellcheck
				/>
			</div>
			{asksAi && !model.hasApiKey && <div className="vk-inline-warning">Add an OpenRouter key in Vikalp settings to ask AI.</div>}

			<NoteField span={span} onChange={(note) => actions.setNote(span.id, note)} />

			<div className="vk-span-actions">
				<button className="vk-link-button" onClick={() => actions.askAi(span.id)} disabled={model.aiPending}>
					<Icon name="sparkles" /> Ask AI
				</button>
				{hasAi && (
					<button className="vk-link-button" onClick={() => actions.removeAiVersions(span.id)}>
						Remove AI versions
					</button>
				)}
				{span.versions.length > 1 && (
					<button className="vk-link-button" onClick={() => actions.settleSpan(span.id)} title="Keep the showing version and drop the rest">
						Settle
					</button>
				)}
			</div>
		</div>
	);
}

function NoteField({ span, onChange }: { span: SpanView; onChange: (note: string) => void }) {
	const [value, setValue] = useState(span.note);
	useEffect(() => setValue(span.note), [span.id, span.note]);
	return (
		<label className="vk-note-field">
			<span className={`vk-note-dot-indicator${value.trim() ? " is-set" : ""}`} />
			<input
				type="text"
				value={value}
				placeholder="Note to self…"
				onInput={(event) => setValue((event.target as HTMLInputElement).value)}
				onBlur={() => value !== span.note && onChange(value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						onChange(value);
					}
				}}
			/>
		</label>
	);
}

function EmptyState({ hasNote }: { hasNote: boolean }) {
	return (
		<div className="vk-empty">
			{hasNote ? (
				<>
					<p>Select a word, sentence or paragraph, then press ⌘⇧A or right-click → Alternatives for selection.</p>
					<p className="vk-empty-hint">Or click a tab above to use the word, sentence or paragraph at the cursor.</p>
				</>
			) : (
				<p>Open a note to play with alternatives.</p>
			)}
		</div>
	);
}

function UnplacedList({ spans, model }: { spans: SpanView[]; model: AlternativesPanelModel }) {
	return (
		<div className="vk-unplaced">
			<div className="vk-section-heading">Unplaced · {spans.length}</div>
			<p className="vk-unplaced-hint">These lost their place after the note changed outside Vikalp.</p>
			{spans.map((span) => (
				<div key={span.id} className="vk-unplaced-item">
					<div className="vk-unplaced-text">{span.lastText ?? span.versions[0]?.text}</div>
					<div className="vk-unplaced-meta">{span.versions.length} versions</div>
					<div className="vk-unplaced-actions">
						<button className="vk-link-button" onClick={() => model.actions.placeOrphan(span.id)}>
							Place on selection
						</button>
						<button className="vk-link-button mod-warning" onClick={() => model.actions.deleteSpan(span.id)}>
							Delete
						</button>
					</div>
				</div>
			))}
		</div>
	);
}
