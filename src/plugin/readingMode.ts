import { MarkdownView, type MarkdownPostProcessorContext } from "obsidian";
import type { TextRange } from "../core/model/types";
import { ghosts } from "../editor/collections";
import type VikalpPlugin from "../main";
import { editorViewOf } from "./noteController";

function stripInlineMarkdown(text: string): string {
	return text
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__|\*|_|`|==|~~)/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function ghostRangesFor(plugin: VikalpPlugin, path: string): { doc: string; ranges: TextRange[] } | null {
	for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
		if (!(leaf.view instanceof MarkdownView) || leaf.view.file?.path !== path) continue;
		const view = editorViewOf(leaf.view);
		if (!view) continue;
		return { doc: view.state.doc.toString(), ranges: ghosts.list(view.state).map((entry) => entry.range) };
	}
	return null;
}

function sectionRange(text: string, lineStart: number, lineEnd: number): TextRange {
	let from = 0;
	for (let line = 0; line < lineStart; line++) from = text.indexOf("\n", from) + 1;
	let to = from;
	for (let line = lineStart; line <= lineEnd; line++) {
		const next = text.indexOf("\n", to);
		to = next === -1 ? text.length : next + 1;
	}
	return { from, to };
}

function countOccurrences(haystack: string, needle: string): number {
	let count = 0;
	for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + 1)) count++;
	return count;
}

/** Wraps the nth occurrence of `text` among the element's text nodes in a ghost span. */
function wrapOccurrence(element: HTMLElement, text: string, occurrence: number) {
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	let seen = 0;
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		const content = node.textContent ?? "";
		for (let index = content.indexOf(text); index !== -1; index = content.indexOf(text, index + 1)) {
			if (seen++ < occurrence) continue;
			const ghostNode = node.splitText(index);
			ghostNode.splitText(text.length);
			const wrapper = document.createElement("span");
			wrapper.className = "vk-ghost";
			ghostNode.replaceWith(wrapper);
			wrapper.appendChild(ghostNode);
			return;
		}
	}
}

/**
 * Reading mode is rendered HTML, not CodeMirror. Ghosted text is still dimmed
 * there, because a reader would not see it. Only ghosts inside the rendered
 * section are applied, at the same occurrence they have in the source.
 */
export function registerReadingModeGhosts(plugin: VikalpPlugin) {
	plugin.registerMarkdownPostProcessor((element: HTMLElement, context: MarkdownPostProcessorContext) => {
		const info = context.getSectionInfo(element);
		const note = ghostRangesFor(plugin, context.sourcePath);
		if (!info || !note || note.ranges.length === 0 || info.text !== note.doc) return;
		const section = sectionRange(info.text, info.lineStart, info.lineEnd);
		for (const ghost of note.ranges.filter((range) => range.from >= section.from && range.to <= section.to)) {
			const text = stripInlineMarkdown(note.doc.slice(ghost.from, ghost.to));
			if (text.length < 2) continue;
			const before = stripInlineMarkdown(note.doc.slice(section.from, ghost.from));
			wrapOccurrence(element, text, countOccurrences(before, text));
		}
	});
}
