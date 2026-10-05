import { useEffect, useState } from "preact/hooks";
import type { OverflowBlock } from "../../core/model/types";
import type { OverflowActions } from "../context";
import { OVERFLOW_DRAG_TYPE as OVERFLOW_DRAG_MIME } from "../../core/constants";
import { relativeTime } from "../format";
import { Icon } from "./Icon";

export interface OverflowPanelProps {
	hasNote: boolean;
	blocks: OverflowBlock[];
	hasPanelSpan: boolean;
	actions: OverflowActions;
	now: number;
	/** The Actions menu hotkey, or null when it has none. */
	actionsKey: string | null;
}

export function OverflowPanel({ hasNote, blocks, hasPanelSpan, actions, now, actionsKey }: OverflowPanelProps) {
	const [draft, setDraft] = useState("");
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

	if (!hasNote) {
		return (
			<div className="vk-panel vk-overflow">
				<div className="vk-empty">
					<p>Open a note to see its Overflow.</p>
				</div>
			</div>
		);
	}

	const addDraft = () => {
		if (!draft.trim()) return;
		actions.addBlock(draft);
		setDraft("");
	};

	return (
		<div className="vk-panel vk-overflow">
			<div className="vk-overflow-new">
				<AutoTextarea
					value={draft}
					placeholder="Jot something to keep nearby…"
					onInput={setDraft}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							addDraft();
						}
					}}
				/>
				{draft.trim() && (
					<button className="vk-compact-button" onClick={addDraft}>
						Add <kbd>⌘↵</kbd>
					</button>
				)}
			</div>

			{blocks.length === 0 ? (
				<div className="vk-empty">
					<p>Nothing stashed yet.</p>
					<p className="vk-empty-hint">
						{actionsKey ? `Select text in the note, press ${actionsKey} then S, or right-click → Stash in Overflow.` : "Select text in the note and right-click → Stash in Overflow."}
					</p>
				</div>
			) : (
				<ul className="vk-overflow-list" onDragLeave={() => setDragOverIndex(null)}>
					{blocks.map((block, index) => (
						<OverflowBlockRow
							key={block.id}
							block={block}
							index={index}
							now={now}
							hasPanelSpan={hasPanelSpan}
							actions={actions}
							isDropTarget={dragOverIndex === index}
							onDragOverRow={() => setDragOverIndex(index)}
							onDropRow={(blockId) => {
								setDragOverIndex(null);
								actions.moveBlock(blockId, index);
							}}
						/>
					))}
				</ul>
			)}
			<div className="vk-panel-footer">⌘↵ inserts at the cursor · drag into the note · ⌥ keeps a copy</div>
		</div>
	);
}

function OverflowBlockRow({
	block,
	index,
	now,
	hasPanelSpan,
	actions,
	isDropTarget,
	onDragOverRow,
	onDropRow,
}: {
	block: OverflowBlock;
	index: number;
	now: number;
	hasPanelSpan: boolean;
	actions: OverflowActions;
	isDropTarget: boolean;
	onDragOverRow: () => void;
	onDropRow: (blockId: string) => void;
}) {
	const [text, setText] = useState(block.text);
	useEffect(() => setText(block.text), [block.text]);

	return (
		<li
			className={`vk-overflow-block${isDropTarget ? " is-drop-target" : ""}`}
			draggable
			onDragStart={(event) => {
				if (!event.dataTransfer) return;
				event.dataTransfer.setData(OVERFLOW_DRAG_MIME, block.id);
				event.dataTransfer.setData("text/plain", block.text);
				event.dataTransfer.effectAllowed = "copyMove";
			}}
			onDragOver={(event) => {
				if (event.dataTransfer?.types.includes(OVERFLOW_DRAG_MIME)) {
					event.preventDefault();
					onDragOverRow();
				}
			}}
			onDrop={(event) => {
				const draggedId = event.dataTransfer?.getData(OVERFLOW_DRAG_MIME);
				if (draggedId && draggedId !== block.id) {
					event.preventDefault();
					onDropRow(draggedId);
				}
			}}
			data-index={index}
		>
			<div className="vk-overflow-body">
				<AutoTextarea
					value={text}
					onInput={setText}
					onBlur={() => text !== block.text && actions.updateBlock(block.id, text)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							if (text !== block.text) actions.updateBlock(block.id, text);
							actions.insertAtCursor(block.id, event.altKey);
						}
					}}
				/>
				<div className="vk-overflow-meta">
					<span className="vk-overflow-age">
						<span className="vk-overflow-grip" title="Drag into the note, or up and down to reorder">
							<Icon name="grip-vertical" />
						</span>
						{relativeTime(block.createdAt, now)}
					</span>
					<span className="vk-overflow-actions">
						<button className="clickable-icon" aria-label="Insert at cursor (⌘↵)" onClick={() => actions.insertAtCursor(block.id, false)}>
							<Icon name="corner-down-left" />
						</button>
						<button className="clickable-icon" aria-label="Copy" onClick={() => actions.copyBlock(block.id)}>
							<Icon name="copy" />
						</button>
						<button
							className="clickable-icon"
							aria-label={hasPanelSpan ? "Add as a version of what the Alternatives panel shows" : "Open alternatives for some text first, then add this as a version"}
							disabled={!hasPanelSpan}
							onClick={() => actions.promoteToAlternative(block.id)}
						>
							<Icon name="split" />
						</button>
						<button className="clickable-icon" aria-label="Delete" onClick={() => actions.deleteBlock(block.id)}>
							<Icon name="trash-2" />
						</button>
					</span>
				</div>
			</div>
		</li>
	);
}

function AutoTextarea({
	value,
	placeholder,
	onInput,
	onBlur,
	onKeyDown,
}: {
	value: string;
	placeholder?: string;
	onInput: (text: string) => void;
	onBlur?: () => void;
	onKeyDown?: (event: KeyboardEvent) => void;
}) {
	return (
		<textarea
			className="vk-autotextarea"
			rows={1}
			value={value}
			placeholder={placeholder}
			spellcheck
			onInput={(event) => onInput((event.target as HTMLTextAreaElement).value)}
			onBlur={onBlur}
			onKeyDown={onKeyDown}
		/>
	);
}
