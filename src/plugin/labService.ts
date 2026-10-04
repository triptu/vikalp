import { EditorView } from "@codemirror/view";
import { Notice, TFile, type App } from "obsidian";
import { AiError, type AiClient } from "../ai/aiClient";
import { newId } from "../core/model/ids";
import { LAB_PASSES, trimLevel, type LabPassId, type TrimLevelId } from "../core/ai/passes";
import { placeQuotes } from "../core/ai/placement";
import { MARKS_SYSTEM, MARKS_TOOL, marksPrompt, marksSchema, type MarksOutput } from "../core/ai/prompts/marks";
import { TRIM_SYSTEM, TRIM_TOOL, trimPrompt, trimSchema, type TrimOutput } from "../core/ai/prompts/trim";
import { numberSentences, renderNumbered, type NumberedSentence } from "../core/ai/units";
import type { TextRange } from "../core/model/types";
import type { VikalpSettings } from "../core/settings";
import { removeRanges } from "../core/text/clean";
import { countWords } from "../core/text/segment";
import { deletionChanges } from "../editor/actions";
import { ghosts, lintMarks, trimProposals, type TrimProposalMeta } from "../editor/collections";
import { noteModeField, setNoteMode } from "../editor/noteFields";
import { snapshotNote } from "../editor/snapshot";
import { VIKALP_EVENT, isolated, noHistory } from "../editor/transactions";
import type { UiStore } from "../store/uiStore";
import { confirmAction } from "./modals";
import type { NoteController } from "./noteController";

const LONG_SENTENCE_WORDS = 28;

/**
 * Runs the Lab: AI mark passes that annotate the note, and trim proposals that
 * fade the words the model would cut. Nothing changes the note without a click.
 */
export class LabService {
	/** Text the writer kept during trim, per note, so new levels don't propose it again. */
	private readonly vetoes = new Map<string, string[]>();
	private walkKeyHandler: ((event: KeyboardEvent) => void) | null = null;
	private trimAbort: AbortController | null = null;

	constructor(
		private readonly app: App,
		private readonly client: AiClient,
		private readonly controller: NoteController,
		private readonly store: UiStore,
		private readonly getSettings: () => VikalpSettings,
		private readonly openLintPanel: () => void,
	) {}

	private requireEditor(): { view: EditorView; path: string } | null {
		const view = this.controller.editor;
		const path = this.controller.activePath;
		if (!view || !path) {
			new Notice("Open a note first.");
			return null;
		}
		if (!this.client.hasKey) {
			new Notice("Add an OpenRouter API key in Vikalp settings to use the Lab.");
			return null;
		}
		return { view, path };
	}

	private sentencesFor(view: EditorView): NumberedSentence[] {
		const doc = view.state.doc.toString();
		const ghostRanges = ghosts.list(view.state).map((entry) => entry.range);
		return numberSentences(doc, ghostRanges);
	}

	async runPass(passId: LabPassId) {
		const target = this.requireEditor();
		if (!target) return;
		const { view } = target;
		const pass = LAB_PASSES.find((candidate) => candidate.id === passId)!;
		const mode = this.getSettings().modelMode;
		const sentences = this.sentencesFor(view);
		if (sentences.length === 0) {
			this.setLab(null, "There is no prose to look at.");
			return;
		}
		const longCandidates = sentences.map((sentence) => ({ id: sentence.id, words: countWords(sentence.text) })).filter((candidate) => candidate.words >= LONG_SENTENCE_WORDS);
		if (passId === "long" && longCandidates.length === 0) {
			this.setLab(null, `No sentence runs past ${LONG_SENTENCE_WORDS} words.`);
			return;
		}
		this.setLab(pass.label, null);
		this.openLintPanel();
		try {
			const voiceExcerpts = passId === "tone" ? await this.voiceExcerpts() : [];
			const { value, model } = await this.client.structured<MarksOutput>({
				purpose: pass.label,
				mode,
				system: MARKS_SYSTEM,
				user: marksPrompt({ pass: passId, numberedNote: renderNumbered(sentences), longCandidates, voiceExcerpts }),
				toolName: MARKS_TOOL,
				toolDescription: "Submit the marks.",
				schema: marksSchema(passId === "typos"),
			});
			const doc = view.state.doc.toString();
			const candidates = (value.marks ?? [])
				.filter((mark) => mark && typeof mark.quote === "string")
				.filter((mark) => passId !== "typos" || (typeof mark.suggestion === "string" && mark.suggestion !== mark.quote))
				.map((mark) => ({ unit_id: mark.unit_id, quote: mark.quote, extra: mark }));
			const { placed, rejected } = placeQuotes(doc, sentences, candidates);
			const existingLab = lintMarks.list(view.state).filter((entry) => entry.meta.ruleId === `lab.${passId}`);
			const entries = placed.map((quote) => ({
				range: { from: quote.from, to: quote.to },
				meta: {
					id: newId("lb"),
					ruleId: `lab.${passId}`,
					label: pass.markLabel,
					message: quote.extra.reason || pass.markLabel,
					severity: passId === "typos" ? ("warning" as const) : ("suggestion" as const),
					scope: "sentence" as const,
					source: "lab" as const,
					model,
					...(passId === "typos" && quote.extra.suggestion !== undefined ? { suggestion: quote.extra.suggestion } : {}),
				},
			}));
			view.dispatch({
				effects: [lintMarks.effects.remove.of(existingLab.map((entry) => entry.meta.id)), lintMarks.effects.add.of(entries)],
				annotations: noHistory,
			});
			const noun = passId === "typos" ? (entries.length === 1 ? "fix" : "fixes") : entries.length === 1 ? "mark" : "marks";
			const summary = entries.length === 0 ? "Nothing to mark. Reads clean." : `${pass.label}: ${entries.length} ${noun}.`;
			this.setLab(null, rejected > 0 ? `${summary} ${rejected} could not be placed.` : summary);
		} catch (error) {
			this.setLab(null, error instanceof AiError ? error.message : `Failed: ${String(error)}`);
		}
	}

	private async voiceExcerpts(): Promise<string[]> {
		const excerpts: string[] = [];
		for (const path of this.getSettings().voiceReferenceNotes) {
			const file = this.app.vault.getAbstractFileByPath(path) ?? this.app.metadataCache.getFirstLinkpathDest(path, "");
			if (file instanceof TFile) {
				const text = (await this.app.vault.cachedRead(file)).replace(/^---[\s\S]*?---\n/, "");
				excerpts.push(text.slice(0, 2000));
			}
		}
		return excerpts;
	}

	clearMarks() {
		const view = this.controller.editor;
		if (!view) return;
		const labMarks = lintMarks.list(view.state).filter((entry) => entry.meta.source === "lab");
		view.dispatch({ effects: lintMarks.effects.remove.of(labMarks.map((entry) => entry.meta.id)), annotations: noHistory });
		this.setLab(null, null);
	}

	private setLab(runningPass: string | null, message: string | null) {
		this.store.setState({ lab: { runningPass, message } });
	}

	// Trim

	async setTrimLevel(level: TrimLevelId) {
		if (level === "original") {
			this.finishTrim();
			return;
		}
		const target = this.requireEditor();
		if (!target) return;
		const { view, path } = target;
		const current = this.store.getState().trim;
		if (current.notePath && current.notePath !== path) this.clearProposals();
		this.stopWalking();
		this.trimAbort?.abort();
		const abort = new AbortController();
		this.trimAbort = abort;

		const beforeWords = snapshotNote(view.state, path).words;
		this.setTrim({ level, status: "reading", beforeWords, message: null, rejected: 0, walking: false, notePath: path });
		const sentences = this.sentencesFor(view);
		const levelInfo = trimLevel(level);
		try {
			const { value } = await this.client.structured<TrimOutput>({
				purpose: `Trim · ${levelInfo.label}`,
				mode: this.getSettings().modelMode,
				system: TRIM_SYSTEM,
				user: trimPrompt({
					numberedNote: renderNumbered(sentences),
					totalWords: beforeWords,
					targetPercent: Math.round(levelInfo.target * 100),
					keep: this.vetoes.get(path) ?? [],
				}),
				toolName: TRIM_TOOL,
				toolDescription: "Submit the proposed deletions.",
				schema: trimSchema,
				signal: abort.signal,
			});
			if (abort.signal.aborted || this.controller.editor !== view) return;
			const doc = view.state.doc.toString();
			const vetoed = new Set(this.vetoes.get(path) ?? []);
			const ghostRanges = ghosts.list(view.state).map((entry) => entry.range);
			const candidates = (value.deletions ?? [])
				.filter((deletion) => deletion && typeof deletion.quote === "string" && !vetoed.has(deletion.quote.trim()))
				.map((deletion) => ({ unit_id: deletion.unit_id, quote: deletion.quote, extra: deletion }));
			const { placed, rejected } = placeQuotes(doc, sentences, candidates);
			const usable = placed.filter((quote) => !ghostRanges.some((range) => range.from < quote.to && quote.from < range.to));
			const entries = usable.map((quote) => ({
				range: { from: quote.from, to: quote.to },
				meta: { id: newId("tp"), why: quote.extra.why ?? "", words: countWords(doc.slice(quote.from, quote.to)) },
			}));
			view.dispatch({ effects: trimProposals.effects.replaceAll.of(entries), annotations: noHistory });
			this.setTrim({ ...this.store.getState().trim, status: "ready", rejected: rejected + (placed.length - usable.length) });
			void this.checkGrammar(view, sentences, entries);
		} catch (error) {
			if (abort.signal.aborted) return;
			this.setTrim({ ...this.store.getState().trim, status: "error", message: error instanceof AiError ? error.message : String(error) });
		}
	}

	/** Asks Jev whether each sentence touched by a cut still reads as a whole sentence; flags the risky cuts. */
	private async checkGrammar(view: EditorView, sentences: NumberedSentence[], entries: Array<{ range: TextRange; meta: TrimProposalMeta }>) {
		const doc = view.state.doc.toString();
		const affected = sentences
			.map((sentence) => ({ sentence, cuts: entries.filter((entry) => entry.range.from >= sentence.from && entry.range.to <= sentence.to) }))
			.filter(({ sentence, cuts }) => cuts.length > 0 && !cuts.some((cut) => cut.range.from === sentence.from && cut.range.to === sentence.to));
		if (affected.length === 0) return;
		const state: Record<string, string> = {};
		const questions: Record<string, { type: "bool"; instructions: string; criteria: { true: string; false: string } }> = {};
		for (const { sentence, cuts } of affected.slice(0, 24)) {
			state[sentence.id] = removeRanges(doc, cuts.map((cut) => cut.range), sentence);
			questions[sentence.id] = {
				type: "bool",
				instructions: `Is the text in "${sentence.id}" a complete, grammatical sentence that reads naturally?`,
				criteria: { true: "Grammatical and complete", false: "Broken, ungrammatical or missing words" },
			};
		}
		try {
			const { answers } = await this.client.classify("Trim grammar check", state, questions);
			if (this.controller.editor !== view) return;
			const risky = new Set(Object.entries(answers).filter(([, probability]) => probability < 0.5).map(([id]) => id));
			const updates = affected
				.filter(({ sentence }) => risky.has(sentence.id))
				.flatMap(({ cuts }) => cuts)
				.map((cut) => trimProposals.list(view.state).find((entry) => entry.meta.id === cut.meta.id))
				.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
				.map((entry) => trimProposals.effects.updateMeta.of({ ...entry.meta, risky: true }));
			if (updates.length) view.dispatch({ effects: updates, annotations: noHistory });
		} catch (error) {
			console.info("Vikalp: grammar check skipped", error);
		}
	}

	veto(view: EditorView, proposalId: string) {
		const entry = trimProposals.list(view.state).find((candidate) => candidate.meta.id === proposalId);
		const path = this.controller.activePath;
		if (!entry || !path) return;
		const text = view.state.doc.sliceString(entry.range.from, entry.range.to).trim();
		this.vetoes.set(path, [...(this.vetoes.get(path) ?? []), text]);
		view.dispatch({ effects: trimProposals.effects.remove.of([proposalId]), annotations: noHistory });
		if (this.store.getState().trim.walking) this.walkTo(view, null);
	}

	ghostCuts() {
		const view = this.controller.editor;
		if (!view) return;
		const proposals = trimProposals.list(view.state);
		if (proposals.length === 0) return;
		view.dispatch(
			isolated({
				effects: [
					trimProposals.effects.replaceAll.of([]),
					ghosts.effects.add.of(proposals.map((proposal) => ({ meta: { id: newId("gh"), createdAt: Date.now() }, range: proposal.range }))),
				],
				userEvent: VIKALP_EVENT.trim,
			}),
		);
		new Notice(`Ghosted ${proposals.length} ${proposals.length === 1 ? "cut" : "cuts"}. Revive any of them from the right-click menu.`);
		this.closeTrim();
	}

	async makeCuts() {
		const view = this.controller.editor;
		if (!view) return;
		const proposals = trimProposals.list(view.state);
		if (proposals.length === 0) return;
		const words = proposals.reduce((sum, proposal) => sum + proposal.meta.words, 0);
		const confirmed = await confirmAction(this.app, {
			title: "Make the cuts?",
			body: `This deletes ${words} ${words === 1 ? "word" : "words"} in ${proposals.length} ${proposals.length === 1 ? "place" : "places"}. Undo brings them back.`,
			confirmLabel: "Make the cuts",
			warning: true,
		});
		if (!confirmed || this.controller.editor !== view) return;
		const current = trimProposals.list(view.state);
		view.dispatch(
			isolated({
				changes: deletionChanges(view.state.doc.toString(), current.map((proposal) => proposal.range)),
				effects: trimProposals.effects.replaceAll.of([]),
				userEvent: VIKALP_EVENT.trim,
			}),
		);
		this.closeTrim();
	}

	walkThrough() {
		const view = this.controller.editor;
		if (!view || trimProposals.list(view.state).length === 0) return;
		this.setTrim({ ...this.store.getState().trim, walking: true });
		this.walkTo(view, null);
		this.walkKeyHandler = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
			const decision = { k: "keep", c: "cut", s: "skip" }[event.key.toLowerCase()] as "keep" | "cut" | "skip" | undefined;
			if (decision) {
				event.preventDefault();
				event.stopPropagation();
				this.walkStep(decision);
			} else if (event.key === "Escape") {
				event.preventDefault();
				this.stopWalking();
			}
		};
		window.addEventListener("keydown", this.walkKeyHandler, true);
	}

	private walkTo(view: EditorView, afterPosition: number | null) {
		const proposals = trimProposals.list(view.state);
		if (proposals.length === 0) {
			this.stopWalking();
			return;
		}
		const next = proposals.find((proposal) => afterPosition === null || proposal.range.from >= afterPosition) ?? proposals[0]!;
		view.dispatch({
			effects: [setNoteMode.of({ walkProposal: next.meta.id }), EditorView.scrollIntoView(next.range.from, { y: "center" })],
			annotations: noHistory,
		});
	}

	walkStep(decision: "keep" | "cut" | "skip") {
		const view = this.controller.editor;
		if (!view) return;
		const currentId = view.state.field(noteModeField).walkProposal;
		const current = trimProposals.list(view.state).find((proposal) => proposal.meta.id === currentId);
		if (!current) {
			this.walkTo(view, null);
			return;
		}
		if (decision === "keep") {
			this.veto(view, current.meta.id);
			this.walkTo(view, current.range.from);
		} else if (decision === "cut") {
			const changes = deletionChanges(view.state.doc.toString(), [current.range]);
			view.dispatch(isolated({ changes, effects: trimProposals.effects.remove.of([current.meta.id]), userEvent: VIKALP_EVENT.trim }));
			this.walkTo(view, current.range.from);
		} else {
			const remaining = trimProposals.list(view.state);
			const index = remaining.findIndex((proposal) => proposal.meta.id === current.meta.id);
			const next = remaining[index + 1];
			if (next) this.walkTo(view, next.range.from);
			else this.stopWalking();
		}
	}

	stopWalking() {
		if (this.walkKeyHandler) window.removeEventListener("keydown", this.walkKeyHandler, true);
		this.walkKeyHandler = null;
		const view = this.controller.editor;
		if (view && view.state.field(noteModeField).walkProposal) view.dispatch({ effects: setNoteMode.of({ walkProposal: null }), annotations: noHistory });
		if (this.store.getState().trim.walking) this.setTrim({ ...this.store.getState().trim, walking: false });
	}

	/** Done: drops proposals that were neither ghosted nor cut. */
	finishTrim() {
		this.trimAbort?.abort();
		this.clearProposals();
		this.closeTrim();
	}

	private clearProposals() {
		for (const view of this.controller.allEditors()) {
			if (trimProposals.list(view.state).length) view.dispatch({ effects: trimProposals.effects.replaceAll.of([]), annotations: noHistory });
		}
	}

	private closeTrim() {
		this.stopWalking();
		this.setTrim({ level: "original", status: "idle", beforeWords: 0, message: null, rejected: 0, walking: false, notePath: null });
	}

	private setTrim(trim: ReturnType<UiStore["getState"]>["trim"]) {
		this.store.setState({ trim });
	}

	dispose() {
		this.stopWalking();
		this.trimAbort?.abort();
	}
}
