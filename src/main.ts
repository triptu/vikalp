import type { EditorView } from "@codemirror/view";
import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { AiClient, type CostRecord } from "./ai/aiClient";
import { newId } from "./core/model/ids";
import { MODEL_MODE_LABELS, mergeSettings, type ModelMode, type VikalpSettings } from "./core/settings";
import { vikalpEditorExtension } from "./editor";
import { noteModeField, setNoteMode } from "./editor/noteFields";
import { SidecarRepository, type FileAdapter } from "./persistence/sidecar";
import { AiAlternatives } from "./plugin/aiAlternatives";
import { registerCommands } from "./plugin/commands";
import { fillEditorMenu } from "./plugin/editorMenu";
import { LabService } from "./plugin/labService";
import { LinterService } from "./plugin/linterService";
import { CostLogModal } from "./plugin/modals";
import { NoteController, editorViewOf } from "./plugin/noteController";
import { LabPopoverHost, TrimBarHost } from "./plugin/overlays";
import { Panels } from "./plugin/panels";
import { ReadThrough } from "./plugin/readThrough";
import { VikalpSettingTab } from "./plugin/settingsTab";
import { StatusBar } from "./plugin/statusBar";
import { createAlternativesActions, createOverflowActions, type AlternativesDeps } from "./plugin/viewActions";
import { registerReadingModeGhosts } from "./plugin/readingMode";
import { createUiStore, type UiStore } from "./store/uiStore";
import type { VikalpViewContext } from "./views/context";
import { ALTERNATIVES_VIEW, AlternativesView, LINT_VIEW, LintView, OVERFLOW_VIEW, OverflowView } from "./views/panelViews";

export default class VikalpPlugin extends Plugin {
	settings!: VikalpSettings;
	store!: UiStore;
	controller!: NoteController;
	panels!: Panels;
	ai!: AiClient;
	aiAlternatives!: AiAlternatives;
	linter!: LinterService;
	lab!: LabService;
	readThrough!: ReadThrough;
	labPopover!: LabPopoverHost;
	alternativesDeps!: AlternativesDeps;
	private statusBar: StatusBar | null = null;
	private trimBar: TrimBarHost | null = null;

	override async onload() {
		this.settings = mergeSettings(await this.loadData());
		this.store = createUiStore();
		this.store.setState({ modelMode: this.settings.modelMode, hasApiKey: this.settings.openRouterApiKey.length > 0 });

		const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		const repository = new SidecarRepository(this.app.vault.adapter as unknown as FileAdapter, pluginDir);
		this.controller = new NoteController(this.app, repository, this.store, () => this.settings);
		this.panels = new Panels(this.app);
		this.ai = new AiClient(() => this.settings, (record) => this.recordCost(record));
		this.aiAlternatives = new AiAlternatives(this.ai, this.store, () => this.settings);
		this.linter = new LinterService(this.app, this.ai, this.controller, this.store, () => this.settings, pluginDir, () => void this.panels.openLint());
		this.lab = new LabService(this.app, this.ai, this.controller, this.store, () => this.settings, () => void this.panels.openLint());
		this.readThrough = new ReadThrough(this.panels);

		this.controller.hooks = {
			applyLintFix: (view, hitId) => this.linter.applyFix(view, hitId),
			ignoreLintHit: (view, hitId) => this.linter.ignore(view, hitId),
			vetoProposal: (view, proposalId) => this.lab.veto(view, proposalId),
			noteChanged: (view, update) => {
				this.readThrough.handleUpdate(update);
				this.linter.handleEdit(view, update);
			},
		};

		this.alternativesDeps = {
			controller: this.controller,
			panels: this.panels,
			ai: this.aiAlternatives,
			articleFix: () => this.settings.articleFix,
			panelSpanId: () => this.store.getState().panelSpanId,
		};
		const viewContext = this.createViewContext();
		this.labPopover = new LabPopoverHost(viewContext, () => this.settings);

		this.registerEditorExtension(vikalpEditorExtension(this.controller));
		this.registerView(ALTERNATIVES_VIEW, (leaf) => new AlternativesView(leaf, viewContext));
		this.registerView(OVERFLOW_VIEW, (leaf) => new OverflowView(leaf, viewContext));
		this.registerView(LINT_VIEW, (leaf) => new LintView(leaf, viewContext));
		registerReadingModeGhosts(this);

		this.addRibbonIcon("layers", "Toggle Overflow", () => void this.panels.toggle(OVERFLOW_VIEW, "right"));
		this.addRibbonIcon("split", "Toggle Alternatives", () => void this.panels.toggle(ALTERNATIVES_VIEW, "left"));
		registerCommands(this);
		this.addSettingTab(new VikalpSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, _editor, info) => {
				const view = info instanceof MarkdownView ? editorViewOf(info) : this.controller.editor;
				if (view) fillEditorMenu(this, menu, view);
			}),
		);
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.controller.refreshActiveView()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.controller.refreshActiveView()));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile && file.extension === "md") void this.controller.handleRename(file.path, oldPath);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "md") void this.controller.handleDelete(file.path);
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			this.statusBar = new StatusBar(this, this.store, () => this.settings, {
				toggleMarkers: () => {
					const view = this.controller.editor;
					if (view) this.toggleMarkers(view);
				},
				openLint: () => {
					void this.panels.openLint();
					const note = this.store.getState().note;
					if (note && note.lintHits.length === 0 && !this.store.getState().lint.running) void this.linter.run();
				},
				toggleLab: (anchor) => this.labPopover.toggle(anchor),
			});
			this.trimBar = new TrimBarHost(this.app, this.store, viewContext);
			this.controller.refreshActiveView();
			void this.linter.loadRules();
			void repository.emptyOldTrash();
		});
	}

	override onunload() {
		this.controller.flushAll();
		this.aiAlternatives.cancelAll();
		this.lab.dispose();
		this.labPopover.close();
		this.statusBar?.dispose();
		this.trimBar?.dispose();
		this.readThrough.restore();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.store.setState({ modelMode: this.settings.modelMode, hasApiKey: this.settings.openRouterApiKey.length > 0 });
		this.statusBar?.render();
	}

	async setModelMode(mode: ModelMode) {
		this.settings.modelMode = mode;
		await this.saveSettings();
	}

	switchOptions() {
		return { articleFix: this.settings.articleFix };
	}

	toggleMarkers(view: EditorView) {
		const markersOn = !view.state.field(noteModeField).markersOn;
		view.dispatch({ effects: setNoteMode.of({ markersOn }) });
	}

	showCostLog() {
		new CostLogModal(this.app, this.store.getState().costs).open();
	}

	private recordCost(record: CostRecord) {
		const entry = { ...record, id: newId("cost"), at: Date.now() };
		this.store.setState({ costs: [...this.store.getState().costs, entry] });
	}

	private createViewContext(): VikalpViewContext {
		return {
			store: this.store,
			alternatives: createAlternativesActions(this.alternativesDeps),
			overflow: createOverflowActions(this.alternativesDeps),
			lint: {
				run: () => void this.linter.run(),
				clear: () => this.linter.clear(),
				jumpTo: (hitId) => this.linter.jumpTo(hitId),
				ignore: (hitId) => {
					const view = this.controller.editor;
					if (view) this.linter.ignore(view, hitId);
				},
				applyFix: (hitId) => {
					const view = this.controller.editor;
					if (view) this.linter.applyFix(view, hitId);
				},
				applyAllFixes: () => void this.linter.applyAllFixes(),
				openRulesFolder: () => this.linter.openRulesFolder(),
				reloadRules: () => void this.linter.reloadRules(),
			},
			lab: {
				setModelMode: (mode) => void this.setModelMode(mode),
				runPass: (passId) => void this.lab.runPass(passId as never),
				setTrimLevel: (level) => {
					this.labPopover.close();
					void this.lab.setTrimLevel(level);
				},
				ghostCuts: () => this.lab.ghostCuts(),
				makeCuts: () => void this.lab.makeCuts(),
				walkThrough: () => this.lab.walkThrough(),
				walkStep: (decision) => this.lab.walkStep(decision),
				stopWalking: () => this.lab.stopWalking(),
				finishTrim: () => this.lab.finishTrim(),
				clearMarks: () => this.lab.clearMarks(),
				openSettings: () => {
					this.labPopover.close();
					const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
					setting?.open();
					setting?.openTabById(this.manifest.id);
				},
				showCostLog: () => this.showCostLog(),
				close: () => this.labPopover.close(),
			},
			modelLabel: (mode) => MODEL_MODE_LABELS[mode],
			trimPrimary: () => this.settings.trimPrimaryAction,
		};
	}

	notify(message: string) {
		new Notice(message);
	}
}
