import { Prec, type EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, hoverTooltip, keymap, type Tooltip, type ViewUpdate } from "@codemirror/view";
import { activeIndex } from "../core/model/span";
import { cycleSpan, deleteVersionFromSpan, type ActionResult } from "./actions";
import { lintMarks } from "./collections";
import { hoverField, setHover } from "./decorations";
import { DEFAULT_EDITOR_SETTINGS, OVERFLOW_DRAG_TYPE, vikalpHost } from "./host";
import { flashField, flashSpan, noteModeField, setNoteMode } from "./noteFields";
import { spanAt, spanMeta, spanRange } from "./spansField";
import { isolated } from "./transactions";

function settingsOf(state: EditorState) {
	return state.facet(vikalpHost)?.settings() ?? DEFAULT_EDITOR_SETTINGS;
}

/** Applies an action's transaction to the view, or shows its message. Returns whether it ran. */
export function runAction(view: EditorView, result: ActionResult<object>): boolean {
	if (!result.ok) {
		view.state.facet(vikalpHost)?.notify(result.message);
		return false;
	}
	view.dispatch(isolated(result.spec));
	return true;
}

function markersActive(state: EditorState): boolean {
	const mode = state.field(noteModeField);
	return mode.markersOn && !mode.readThrough;
}

function hoveredSpanForKeys(state: EditorState): string | null {
	const hover = state.field(hoverField);
	if (!hover.spanId || !hover.armed || !markersActive(state) || !settingsOf(state).hoverCycling) return null;
	return spanMeta(state, hover.spanId) && spanRange(state, hover.spanId) ? hover.spanId : null;
}

function cycleHovered(step: number) {
	return (view: EditorView) => {
		const spanId = hoveredSpanForKeys(view.state);
		if (!spanId) return false;
		const meta = spanMeta(view.state, spanId);
		if (!meta || meta.versions.length < 2) return false;
		return runAction(view, cycleSpan(view.state, spanId, step, settingsOf(view.state)));
	};
}

function cycleAtCursor(step: number) {
	return (view: EditorView) => {
		if (!markersActive(view.state)) return false;
		const spanId = spanAt(view.state, view.state.selection.main.head);
		const meta = spanId ? spanMeta(view.state, spanId) : undefined;
		if (!spanId || !meta || meta.versions.length < 2) return false;
		return runAction(view, cycleSpan(view.state, spanId, step, settingsOf(view.state)));
	};
}

function deleteHoveredVersion(view: EditorView): boolean {
	const spanId = hoveredSpanForKeys(view.state);
	const meta = spanId ? spanMeta(view.state, spanId) : undefined;
	if (!spanId || !meta || meta.versions.length < 2) return false;
	return runAction(view, deleteVersionFromSpan(view.state, spanId, meta.activeVersion, { ...settingsOf(view.state), prefer: "next" }));
}

/** Arrow keys cycle the hovered span; Alt+arrows cycle the span at the cursor. Idle keys fall through. */
export const cycleKeymap = Prec.highest(
	keymap.of([
		{ key: "ArrowUp", run: cycleHovered(-1) },
		{ key: "ArrowLeft", run: cycleHovered(-1) },
		{ key: "ArrowDown", run: cycleHovered(1) },
		{ key: "ArrowRight", run: cycleHovered(1) },
		{ key: "Alt-ArrowUp", run: cycleAtCursor(-1) },
		{ key: "Alt-ArrowDown", run: cycleAtCursor(1) },
		{ key: "Alt-Backspace", run: deleteHoveredVersion },
		{
			key: "Escape",
			run: (view) => {
				if (!view.state.field(noteModeField).readThrough) return false;
				view.dispatch({ effects: setNoteMode.of({ readThrough: false }) });
				return true;
			},
		},
	]),
);

const NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Alt", "Shift", "Meta", "Control", "Backspace"]);

function hoverFromEvent(view: EditorView, event: MouseEvent): string | null {
	const target = event.target instanceof HTMLElement ? event.target : null;
	const marked = target?.closest<HTMLElement>("[data-vk-span]");
	if (marked?.dataset.vkSpan) return marked.dataset.vkSpan;
	const line = target?.closest<HTMLElement>(".vk-span-para");
	if (line) {
		const position = view.posAtDOM(line);
		return spanAt(view.state, position + 1);
	}
	return null;
}

function updateHover(view: EditorView, spanId: string | null, armed: boolean) {
	const current = view.state.field(hoverField);
	if (current.spanId === spanId && current.armed === armed) return;
	view.dispatch({ effects: setHover.of({ spanId, armed }) });
}

/** Mouse and keyboard listeners: hover tracking, vetoing trim proposals, dropping Overflow blocks. */
export const domHandlers = EditorView.domEventHandlers({
	mousemove(event, view) {
		const spanId = markersActive(view.state) ? hoverFromEvent(view, event) : null;
		updateHover(view, spanId, spanId !== null);
		return false;
	},
	mouseleave(_event, view) {
		updateHover(view, null, false);
		return false;
	},
	keydown(event, view) {
		if (!NAVIGATION_KEYS.has(event.key) && view.state.field(hoverField).armed) {
			updateHover(view, view.state.field(hoverField).spanId, false);
		}
		return false;
	},
	mousedown(event, view) {
		const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-vk-proposal]") : null;
		if (!target?.dataset.vkProposal || event.button !== 0 || event.shiftKey) return false;
		view.state.facet(vikalpHost)?.vetoProposal(view, target.dataset.vkProposal);
		event.preventDefault();
		return true;
	},
	dragover(event) {
		if (event.dataTransfer?.types.includes(OVERFLOW_DRAG_TYPE)) {
			event.preventDefault();
			event.dataTransfer.dropEffect = event.altKey ? "copy" : "move";
		}
		return false;
	},
	drop(event, view) {
		const blockId = event.dataTransfer?.getData(OVERFLOW_DRAG_TYPE);
		if (!blockId) return false;
		const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
		event.preventDefault();
		view.state.facet(vikalpHost)?.dropOverflowBlock(view, blockId, position, event.altKey);
		return true;
	},
});

/** Clears the short-lived "just swapped" mark after the fade finishes. */
const flashClearer = ViewPlugin.fromClass(
	class {
		private timer: number | null = null;
		constructor(readonly view: EditorView) {}
		update(update: ViewUpdate) {
			const flashing = update.state.field(flashField);
			if (flashing && flashing !== update.startState.field(flashField)) {
				if (this.timer) window.clearTimeout(this.timer);
				this.timer = window.setTimeout(() => {
					this.timer = null;
					if (this.view.state.field(flashField)) this.view.dispatch({ effects: flashSpan.of(null) });
				}, 260);
			}
		}
		destroy() {
			if (this.timer) window.clearTimeout(this.timer);
		}
	},
);

/** Tells the plugin when an editor appears, changes and goes away. */
const hostBridge = ViewPlugin.fromClass(
	class {
		constructor(readonly view: EditorView) {
			view.state.facet(vikalpHost)?.editorCreated(view);
		}
		update(update: ViewUpdate) {
			update.state.facet(vikalpHost)?.editorUpdated(update);
		}
		destroy() {
			this.view.state.facet(vikalpHost)?.editorDestroyed(this.view);
		}
	},
);

function tooltipButton(parent: HTMLElement, label: string, onClick: () => void, primary = false) {
	const button = document.createElement("button");
	button.textContent = label;
	button.className = primary ? "vk-tooltip-button mod-cta" : "vk-tooltip-button";
	button.addEventListener("mousedown", (event) => event.preventDefault());
	button.addEventListener("click", onClick);
	parent.appendChild(button);
}

function appendText(parent: HTMLElement, tag: string, className: string, text: string) {
	const element = document.createElement(tag);
	element.className = className;
	element.textContent = text;
	parent.appendChild(element);
	return element;
}

/** Hover cards for lint marks (rules hit, fixes) and for spans that carry a note. */
const vikalpTooltips = hoverTooltip(
	(view, position): Tooltip | null => {
		const mode = view.state.field(noteModeField);
		if (mode.readThrough) return null;
		const hits = lintMarks.at(view.state, position).filter((hit) => hit.meta.scope !== "document");
		const spanId = mode.markersOn ? spanAt(view.state, position) : null;
		const meta = spanId ? spanMeta(view.state, spanId) : undefined;
		const spanNote = meta?.note?.trim();
		if (hits.length === 0 && !spanNote) return null;

		const start = Math.min(...hits.map((hit) => hit.range.from), spanNote && spanId ? spanRange(view.state, spanId)!.from : Infinity);
		const end = Math.max(...hits.map((hit) => hit.range.to), spanNote && spanId ? spanRange(view.state, spanId)!.to : -Infinity);
		return {
			pos: start,
			end,
			above: true,
			create: () => {
				const dom = document.createElement("div");
				dom.className = "vk-tooltip";
				if (spanNote && meta) {
					const noteRow = appendText(dom, "div", "vk-tooltip-note", spanNote);
					noteRow.prepend(Object.assign(document.createElement("span"), { className: "vk-tooltip-note-dot" }));
					appendText(dom, "div", "vk-tooltip-meta", `${activeIndex(meta) + 1} of ${meta.versions.length} versions`);
				}
				for (const { meta: hit } of hits) {
					const row = document.createElement("div");
					row.className = `vk-tooltip-hit vk-severity-${hit.severity}`;
					const heading = document.createElement("div");
					heading.className = "vk-tooltip-hit-heading";
					appendText(heading, "span", "vk-tooltip-rule", hit.label);
					if (hit.source === "lab") appendText(heading, "span", "vk-ai-badge", "AI");
					row.appendChild(heading);
					appendText(row, "div", "vk-tooltip-message", hit.message);
					if (hit.suggestion !== undefined) {
						const fix = appendText(row, "div", "vk-tooltip-fix", "");
						appendText(fix, "span", "vk-tooltip-fix-label", "Fix: ");
						appendText(fix, "span", "vk-tooltip-fix-text", hit.suggestion || "(delete)");
					}
					const host = view.state.facet(vikalpHost);
					if (host) {
						const actions = document.createElement("div");
						actions.className = "vk-tooltip-actions";
						if (hit.suggestion !== undefined) tooltipButton(actions, "Apply", () => host.applyLintFix(view, hit.id), true);
						tooltipButton(actions, "Ignore", () => host.ignoreLintHit(view, hit.id));
						row.appendChild(actions);
					}
					dom.appendChild(row);
				}
				return { dom };
			},
		};
	},
	{ hoverTime: 350 },
);

export const vikalpInteraction = [cycleKeymap, domHandlers, flashClearer, hostBridge, vikalpTooltips];
