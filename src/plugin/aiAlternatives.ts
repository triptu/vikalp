import type { EditorView } from "@codemirror/view";
import { Notice } from "obsidian";
import { AiError, type AiClient } from "../ai/aiClient";
import { acceptableAlternatives, placeQuotes } from "../core/ai/placement";
import { SPOTS_PASS } from "../core/ai/passes";
import { SPOTS_SYSTEM, SPOTS_TOOL, spotsPrompt, spotsSchema, type SpotsOutput } from "../core/ai/prompts/spots";
import { numberSentences, renderNumbered } from "../core/ai/units";
import { ALTERNATIVES_SYSTEM, ALTERNATIVES_TOOL, alternativesPrompt, alternativesSchema, type AlternativesOutput } from "../core/ai/prompts/alternatives";
import type { VikalpSettings } from "../core/settings";
import { findBlocks } from "../core/text/markdown";
import { addVersionToSpan, createSpanFromSelection, removeAiVersions } from "../editor/actions";
import { ghosts } from "../editor/collections";
import { runAction } from "../editor/interaction";
import { noteModeField, notePathOf, setNoteMode } from "../editor/noteFields";
import { noHistory } from "../editor/transactions";
import { listSpans, removeSpan, spanMeta, spanRange } from "../editor/spansField";
import type { UiStore } from "../store/uiStore";

const MAX_SPOTS = 8;

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
		if (!this.client.isReady) {
			new Notice(`${this.client.setupHint} to ask for AI alternatives.`);
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
					// Kept out of undo history so Cmd+Z doesn't step through invisible additions; "Remove AI versions" clears them.
					view.dispatch({ ...result.spec, annotations: noHistory });
					addedCount++;
				}
			}
			for (const text of fresh) added.add(text);
		};

		try {
			const { value } = await this.client.structured<AlternativesOutput>({
				purpose: `Alternatives for “${truncate(meta.versions[0].text, 40)}”`,
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

	/**
	 * Finds the spots in the note (or the selection) where trying another
	 * wording is most worth it, makes each a span, and adds AI versions to it,
	 * all from one model call. The note's text doesn't change.
	 */
	async suggestSpots(view: EditorView, noteTitle: string) {
		if (!this.client.isReady) {
			new Notice(`${this.client.setupHint} to find words worth playing with.`);
			return;
		}
		if (this.store.getState().lab.runningPass) return;
		const path = notePathOf(view);
		const selection = view.state.selection.main;
		const within = selection.empty ? null : { from: selection.from, to: selection.to };
		const doc = view.state.doc.toString();
		const ghostRanges = ghosts.list(view.state).map((entry) => entry.range);
		const sentences = numberSentences(doc, ghostRanges).filter((sentence) => !within || (sentence.to > within.from && sentence.from < within.to));
		if (sentences.length === 0) {
			new Notice(within ? "Select some prose first." : "There is no prose to look at.");
			return;
		}
		const settings = this.getSettings();
		const mode = settings.modelMode;
		const model = this.client.modelId(mode);
		const where = within ? "the selection" : "this note";
		this.setLab(SPOTS_PASS, null);
		if (!view.state.field(noteModeField).markersOn) view.dispatch({ effects: setNoteMode.of({ markersOn: true }) });

		let spotsAdded = 0;
		let versionsAdded = 0;
		const handled = new Set<string>();
		const addSpot = (spot: SpotsOutput["spots"][number] | undefined) => {
			if (!spot?.quote || !Array.isArray(spot.alternatives) || notePathOf(view) !== path) return;
			const key = `${spot.unit_id}|${spot.quote}`;
			if (handled.has(key)) return;
			handled.add(key);
			const currentSentences = numberSentences(view.state.doc.toString(), ghostRanges);
			const { placed } = placeQuotes(view.state.doc.toString(), currentSentences, [{ unit_id: spot.unit_id, quote: spot.quote, extra: null }]);
			const range = placed[0];
			if (!range) return;
			const created = createSpanFromSelection(view.state, { from: range.from, to: range.to });
			if (!created.ok) return;
			if (created.created) view.dispatch({ ...created.spec, annotations: noHistory });
			let added = 0;
			for (const text of acceptableAlternatives(spanMeta(view.state, created.spanId)!, spot.alternatives, settings.alternativesCount)) {
				const result = addVersionToSpan(view.state, created.spanId, text, "ai", { articleFix: false, activate: false, model });
				if (result.ok && result.version) {
					view.dispatch({ ...result.spec, annotations: noHistory });
					added++;
				}
			}
			if (added > 0) {
				spotsAdded++;
				versionsAdded += added;
			} else if (created.created) {
				view.dispatch({ effects: removeSpan.of({ id: created.spanId }), annotations: noHistory });
			}
		};

		try {
			const { value } = await this.client.structured<SpotsOutput>({
				purpose: `Find words worth playing with in ${where}`,
				mode,
				system: SPOTS_SYSTEM,
				user: spotsPrompt({
					noteTitle,
					numberedNote: renderNumbered(sentences),
					maxSpots: MAX_SPOTS,
					perSpot: settings.alternativesCount,
					existingSpans: listSpans(view.state).flatMap((span) => (span.range ? [view.state.doc.sliceString(span.range.from, span.range.to)] : [])),
				}),
				toolName: SPOTS_TOOL,
				toolDescription: "Submit the spots and their alternatives.",
				schema: spotsSchema,
				onPartial: (partial) => {
					const spots = Array.isArray(partial.spots) ? partial.spots : [];
					for (const spot of spots.slice(0, -1)) addSpot(spot);
				},
			});
			for (const spot of value.spots ?? []) addSpot(spot);
			const message =
				spotsAdded === 0
					? `Nothing in ${where} stood out as worth rewording.`
					: `Added ${versionsAdded} AI versions at ${spotsAdded} ${spotsAdded === 1 ? "spot" : "spots"}. Hover a marked word and use the arrow keys.`;
			this.setLab(null, message);
			new Notice(message, 6000);
		} catch (error) {
			const message = error instanceof AiError ? error.message : `Finding spots failed: ${String(error)}`;
			this.setLab(null, message);
			new Notice(message, 6000);
		}
	}

	/** Removes every AI version in the note. Spans left with one version stop being spans. */
	removeAllAiVersions(view: EditorView): number {
		let removed = 0;
		for (const { meta } of listSpans(view.state)) {
			if (!meta.versions.some((version) => version.source === "ai")) continue;
			const result = removeAiVersions(view.state, meta.id, { articleFix: false });
			// Through history: if an AI version was showing, the text changes back, and that must be undoable.
			if (result.ok && runAction(view, result)) removed += result.removed;
		}
		return removed;
	}

	private setLab(runningPass: string | null, message: string | null) {
		this.store.setState({ lab: { runningPass, message } });
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
