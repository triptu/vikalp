import { MarkdownView } from "obsidian";
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

function ghostTextsFor(plugin: VikalpPlugin, path: string): string[] {
	for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
		if (!(leaf.view instanceof MarkdownView) || leaf.view.file?.path !== path) continue;
		const view = editorViewOf(leaf.view);
		if (!view) continue;
		const doc = view.state.doc;
		return ghosts.list(view.state).map((entry) => stripInlineMarkdown(doc.sliceString(entry.range.from, entry.range.to)));
	}
	return [];
}

/**
 * Reading mode is rendered HTML, not CodeMirror. Ghosted text is still dimmed
 * there, because a reader would not see it. Nothing else is drawn.
 */
export function registerReadingModeGhosts(plugin: VikalpPlugin) {
	plugin.registerMarkdownPostProcessor((element, context) => {
		const texts = ghostTextsFor(plugin, context.sourcePath).filter((text) => text.length > 1);
		if (texts.length === 0) return;
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
		for (const node of nodes) {
			for (const text of texts) {
				const content = node.textContent ?? "";
				const index = content.indexOf(text);
				if (index === -1) continue;
				const ghostNode = node.splitText(index);
				ghostNode.splitText(text.length);
				const wrapper = document.createElement("span");
				wrapper.className = "vk-ghost";
				ghostNode.replaceWith(wrapper);
				wrapper.appendChild(ghostNode);
				break;
			}
		}
	});
}
