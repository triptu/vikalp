import { WidgetType } from "@codemirror/view";

interface DotState {
	count: number;
	active: number;
	hasNote: boolean;
}

function renderDots(container: HTMLElement, { count, active, hasNote }: DotState) {
	for (let index = 0; index < count; index++) {
		const dot = container.createSpan({ cls: "vk-dot" });
		if (index === active) dot.addClass("is-active");
		if (index === 0) dot.addClass("is-original");
	}
	if (hasNote) container.createSpan({ cls: "vk-dot vk-note-dot", attr: { "aria-label": "Has a note" } });
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
		const anchor = createSpan({ cls: "vk-dots", attr: { "aria-hidden": "true", "data-vk-span": this.spanId } });
		renderDots(anchor.createSpan({ cls: "vk-dots-row" }), this.dots);
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
		const anchor = createSpan({ cls: "vk-para-dots", attr: { "aria-hidden": "true", "data-vk-span": this.spanId } });
		renderDots(anchor.createSpan({ cls: "vk-para-dots-column" }), this.dots);
		return anchor;
	}

	override ignoreEvent(): boolean {
		return false;
	}
}
