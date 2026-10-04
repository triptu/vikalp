import type { EditorView } from "@codemirror/view";
import { Notice } from "obsidian";
import { AiError, type AiClient } from "../ai/aiClient";
import { acceptableAlternatives } from "../core/ai/placement";
import { ALTERNATIVES_SYSTEM, ALTERNATIVES_TOOL, alternativesPrompt, alternativesSchema, type AlternativesOutput } from "../core/ai/prompts/alternatives";
import type { VikalpSettings } from "../core/settings";
import { findBlocks } from "../core/text/markdown";
import { addVersionToSpan } from "../editor/actions";
import { runAction } from "../editor/interaction";
import { spanMeta, spanRange } from "../editor/spansField";
import type { UiStore } from "../store/uiStore";

/**
 * Asks the selected model for alternatives to a span and adds them, marked as
 * AI, as they stream in. The showing version never changes; the writer picks.
 */
export class AiAlternatives {
	private readonly inFlight = new Map<string, AbortController>();

	constructor(
		private readonly client: AiClient,
		private readonly store: UiStore,
		private readonly getSettings: () => VikalpSettings,
	) {}

	async request(view: EditorView, spanId: string, noteTitle: string) {
		if (this.inFlight.has(spanId)) return;
		if (!this.client.hasKey) {
			new Notice("Add an OpenRouter API key in Vikalp settings to ask for AI alternatives.");
			return;
		}
		const meta = spanMeta(view.state, spanId);
		const range = spanRange(view.state, spanId);
		if (!meta || !range) return;

		const doc = view.state.doc.toString();
		const blocks = findBlocks(doc);
		const blockIndex = blocks.findIndex((block) => block.from <= range.from && range.to <= block.to);
		const block = blocks[blockIndex] ?? { from: range.from, to: range.to };
		const paragraphWithMarker = `${doc.slice(block.from, range.from)}⟦${doc.slice(range.from, range.to)}⟧${doc.slice(range.to, block.to)}`;
		const neighbour = (index: number) => {
			const candidate = blocks[index];
			return candidate ? doc.slice(candidate.from, candidate.to) : "";
		};
		const settings = this.getSettings();
		const count = settings.alternativesCount;
		const mode = settings.modelMode;
		const controller = new AbortController();
		this.inFlight.set(spanId, controller);
		this.setPending(spanId, true);

		const added = new Set<string>();
		let addedCount = 0;
		const addReady = (texts: string[]) => {
			const current = spanMeta(view.state, spanId);
			if (!current) return;
			const fresh = texts.filter((text) => !added.has(text));
			for (const text of acceptableAlternatives(current, fresh, Math.max(0, count + 1 - addedCount))) {
				added.add(text);
				const latest = spanMeta(view.state, spanId);
				if (!latest) return;
				const result = addVersionToSpan(view.state, spanId, text, "ai", { articleFix: false, activate: false, model: this.client.modelId(mode) });
				if (result.ok && result.version) {
					runAction(view, result);
					addedCount++;
				}
			}
			for (const text of fresh) added.add(text);
		};

		try {
			const { value } = await this.client.structured<AlternativesOutput>({
				purpose: `Alternatives for “${truncate(meta.versions[0]!.text, 40)}”`,
				mode,
				system: ALTERNATIVES_SYSTEM,
				user: alternativesPrompt({
					noteTitle,
					unit: meta.unit,
					spanText: doc.slice(range.from, range.to),
					paragraphWithMarker,
					previousParagraph: neighbour(blockIndex - 1),
					nextParagraph: neighbour(blockIndex + 1),
					existingVersions: meta.versions.map((version) => version.text),
					count,
				}),
				toolName: ALTERNATIVES_TOOL,
				toolDescription: "Submit the alternative versions.",
				schema: alternativesSchema,
				signal: controller.signal,
				onPartial: (partial) => {
					const items = Array.isArray(partial.alternatives) ? partial.alternatives : [];
					const complete = items.slice(0, -1).map((item) => item?.text ?? "").filter(Boolean);
					if (complete.length) addReady(complete);
				},
			});
			addReady((value.alternatives ?? []).map((item) => item?.text ?? ""));
			if (addedCount === 0) new Notice("The model had nothing new to add.");
		} catch (error) {
			new Notice(error instanceof AiError ? error.message : `AI alternatives failed: ${String(error)}`, 6000);
		} finally {
			this.inFlight.delete(spanId);
			this.setPending(spanId, false);
		}
	}

	cancelAll() {
		for (const controller of this.inFlight.values()) controller.abort();
	}

	private setPending(spanId: string, pending: boolean) {
		const current = this.store.getState().aiPendingSpans;
		this.store.setState({ aiPendingSpans: pending ? [...current, spanId] : current.filter((id) => id !== spanId) });
	}
}

function truncate(text: string, length: number): string {
	return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
