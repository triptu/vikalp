import { WidgetType } from "@codemirror/view";

interface DotState {
	count: number;
	active: number;
	hasNote: boolean;
}

function renderDots(container: HTMLElement, { count, active, hasNote }: DotState) {
	for (let index = 0; index < count; index++) {
		const dot = appendSpan(container, "vk-dot");
		if (index === active) dot.classList.add("is-active");
		if (index === 0) dot.classList.add("is-original");
	}
	if (hasNote) {
		const noteDot = appendSpan(container, "vk-dot vk-note-dot");
		noteDot.setAttribute("aria-label", "Has a note");
	}
}

function appendSpan(parent: HTMLElement, className: string): HTMLSpanElement {
	const span = document.createElement("span");
	span.className = className;
	parent.appendChild(span);
	return span;
}

/** The row of tiny dots under the end of a word or sentence span. One dot per version. */
export class DotRowWidget extends WidgetType {
	constructor(
		readonly spanId: string,
		readonly dots: DotState,
	) {
		super();
	}

	override eq(other: DotRowWidget): boolean {
		return other.spanId === this.spanId && other.dots.count === this.dots.count && other.dots.active === this.dots.active && other.dots.hasNote === this.dots.hasNote;
	}

	toDOM(): HTMLElement {
		const anchor = document.createElement("span");
		anchor.className = "vk-dots";
		anchor.setAttribute("aria-hidden", "true");
		anchor.dataset.vkSpan = this.spanId;
		const row = appendSpan(anchor, "vk-dots-row");
		renderDots(row, this.dots);
		return anchor;
	}

	override ignoreEvent(): boolean {
		return false;
	}
}

/** The column of dots beside a paragraph span's margin bar. */
export class ParagraphDotsWidget extends WidgetType {
	constructor(
		readonly spanId: string,
		readonly dots: DotState,
	) {
		super();
	}

	override eq(other: ParagraphDotsWidget): boolean {
		return other.spanId === this.spanId && other.dots.count === this.dots.count && other.dots.active === this.dots.active && other.dots.hasNote === this.dots.hasNote;
	}

	toDOM(): HTMLElement {
		const anchor = document.createElement("span");
		anchor.className = "vk-para-dots";
		anchor.setAttribute("aria-hidden", "true");
		anchor.dataset.vkSpan = this.spanId;
		const column = appendSpan(anchor, "vk-para-dots-column");
		renderDots(column, this.dots);
		return anchor;
	}

	override ignoreEvent(): boolean {
		return false;
	}
}
