import type { EditorView } from "@codemirror/view";
import { MarkdownView, Menu, Notice, Plugin, TFile } from "obsidian";
import { AiClient, type CostRecord } from "./ai/aiClient";
import { newId } from "./core/model/ids";
import { runsLocally, type ProviderId } from "./core/providers";
import { activeProvider, loadSettings, modelFor, stashApiKeys, type ApiKeyStore, type ModelMode, type SavedSettings, type VikalpSettings } from "./core/settings";
import { vikalpEditorExtension } from "./editor";
import { noteModeField, setNoteMode } from "./editor/noteFields";
import { SidecarRepository } from "./persistence/sidecar";
import { ActionMenuHost } from "./plugin/actionMenu";
import { AiAlternatives } from "./plugin/aiAlternatives";
import { secretApiKeyStore } from "./plugin/apiKeyStore";
import { HOTKEY_COMMANDS, registerCommands, registerHotkeyCommands } from "./plugin/commands";
import { fillEditorMenu } from "./plugin/editorMenu";
import { LabService } from "./plugin/labService";
import { LinterService } from "./plugin/linterService";
import { CostLogModal } from "./plugin/modals";
import { NoteController, editorViewOf } from "./plugin/noteController";
import { OpenModelPicksCache } from "./plugin/openModelPicks";
import { LabPopoverHost, TrimBarHost } from "./plugin/overlays";
import { Panels } from "./plugin/panels";
import { ReadThrough } from "./plugin/readThrough";
import { requestJson } from "./plugin/requestJson";
import { VikalpSettingTab } from "./plugin/settingsTab";
import { StatusBar } from "./plugin/statusBar";
import { createAlternativesActions, createOverflowActions, type AlternativesDeps } from "./plugin/viewActions";
import { registerReadingModeGhosts } from "./plugin/readingMode";
import { createUiStore, type KeyHints, type UiStore } from "./store/uiStore";
import type { VikalpViewContext } from "./views/context";
import { ALTERNATIVES_VIEW, AlternativesView, LINT_VIEW, LintView, OVERFLOW_VIEW, OverflowView } from "./views/panelViews";

export default class VikalpPlugin extends Plugin {
	declare settings: VikalpSettings;
	store!: UiStore;
	controller!: NoteController;
	panels!: Panels;
	ai!: AiClient;
	openModels!: OpenModelPicksCache;
	aiAlternatives!: AiAlternatives;
	linter!: LinterService;
	lab!: LabService;
	readThrough!: ReadThrough;
	labPopover!: LabPopoverHost;
	actionMenu!: ActionMenuHost;
	alternativesDeps!: AlternativesDeps;
	private statusBar: StatusBar | null = null;
	private trimBar: TrimBarHost | null = null;
	private apiKeys: ApiKeyStore | null = null;

	override async onload() {
		this.apiKeys = secretApiKeyStore(this.app);
		const { settings, moved } = loadSettings((await this.loadData()) as Partial<SavedSettings> | null, this.apiKeys);
		this.settings = settings;
		// Keys saved by earlier versions sit in data.json; they leave it once secret storage has them.
		if (moved) await this.saveData(moved);
		this.store = createUiStore();
		this.ai = new AiClient(() => this.settings, (record) => this.recordCost(record), requestJson);
		this.syncStore();

		const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		this.openModels = new OpenModelPicksCache(this.app.vault.adapter, `${pluginDir}/model-picks.json`, requestJson);
		const repository = new SidecarRepository(this.app.vault.adapter, pluginDir, (notePath, backup) => {
			new Notice(`Vikalp couldn't read the saved alternatives for "${notePath}". The file was kept as ${backup.replace(/^.*\//, "")}.`, 10000);
		});
		this.controller = new NoteController(this.app, repository, this.store, () => this.settings);
		this.panels = new Panels(this.app);
		this.aiAlternatives = new AiAlternatives(this.ai, this.store, () => this.settings);
		this.linter = new LinterService(this.app, this.ai, this.controller, this.store, () => this.settings, pluginDir, () => void this.panels.openLint());
		this.lab = new LabService(this.app, this.ai, this.controller, this.store, () => this.settings, () => void this.panels.openLint());
		this.readThrough = new ReadThrough(this.panels);

		this.controller.hooks = {
			applyLintFix: (view, hitId) => this.linter.applyFix(view, hitId),
			ignoreLintHit: (view, hitId) => this.linter.ignore(view, hitId),
			vetoProposal: (view, proposalId) => this.lab.veto(view, proposalId),
			revealLintHit: (_view, hitId) => this.store.setState({ lintFocus: { hitId, at: Date.now() } }),
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
			store: this.store,
		};
		const viewContext = this.createViewContext();
		this.labPopover = new LabPopoverHost(viewContext);
		this.actionMenu = new ActionMenuHost(this);

		this.registerEditorExtension(vikalpEditorExtension(this.controller));
		this.registerView(ALTERNATIVES_VIEW, (leaf) => new AlternativesView(leaf, viewContext));
		this.registerView(OVERFLOW_VIEW, (leaf) => new OverflowView(leaf, viewContext));
		this.registerView(LINT_VIEW, (leaf) => new LintView(leaf, viewContext));
		registerReadingModeGhosts(this);

		this.addRibbonIcon("layers", "Toggle Overflow", () => void this.panels.toggle(OVERFLOW_VIEW, "right"));
		this.addRibbonIcon("split", "Toggle Alternatives", () => void this.panels.toggle(ALTERNATIVES_VIEW, "left"));
		registerCommands(this);
		this.addSettingTab(new VikalpSettingTab(this.app, this));
		this.app.workspace.onLayoutReady(() => this.refreshKeyHints());
		// Hotkeys change in the Settings window; refresh the hints when the writer comes back.
		this.registerDomEvent(window, "focus", () => this.refreshKeyHints());

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
			this.statusBar = new StatusBar(this, this.store, {
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
		this.linter.dispose();
		this.labPopover.close();
		this.actionMenu.close();
		this.statusBar?.dispose();
		this.trimBar?.dispose();
		this.readThrough.restore();
	}

	async saveSettings() {
		await this.saveData(stashApiKeys(this.settings, this.apiKeys));
		this.syncStore();
		this.statusBar?.render();
	}

	/** Copies the settings the views show into the store. */
	private syncStore() {
		const active = activeProvider(this.settings);
		this.store.setState({
			modelMode: this.settings.modelMode,
			aiModel: {
				providerLabel: active.preset.label,
				hasModes: active.preset.modes !== null,
				modelId: modelFor(this.settings, this.settings.modelMode),
				free: runsLocally(active.preset.id, active.baseUrl),
			},
			aiSetupHint: this.ai.isReady ? null : this.ai.setupHint,
			lintLayout: this.settings.lintLayout,
		});
	}

	async setProvider(provider: ProviderId) {
		this.settings.provider = provider;
		await this.saveSettings();
	}

	/** Whether the provider in use has a key. The key itself never goes back to the settings page. */
	hasApiKey(): boolean {
		return activeProvider(this.settings).apiKey !== "";
	}

	async setApiKey(key: string) {
		this.settings.providers[this.settings.provider].apiKey = key.trim();
		await this.saveSettings();
	}

	async setModelMode(mode: ModelMode) {
		this.settings.modelMode = mode;
		await this.saveSettings();
	}

	/** Turns Vikalp's suggested hotkeys on or off by registering the commands that carry them again. */
	async setSuggestedHotkeys(enabled: boolean) {
		this.settings.suggestedHotkeys = enabled;
		await this.saveSettings();
		for (const id of Object.values(HOTKEY_COMMANDS)) this.removeCommand(id);
		registerHotkeyCommands(this, enabled);
		this.refreshKeyHints();
	}

	/** Reads the hotkeys the main commands have now, so the hints in the panels match them. */
	refreshKeyHints() {
		// Obsidian has no public API for a command's current hotkey, so this reads the internal one when it exists.
		const manager = (this.app as unknown as { hotkeyManager?: { printHotkeyForCommand?: (commandId: string) => string } }).hotkeyManager;
		const hintFor = (commandId: string) => manager?.printHotkeyForCommand?.(`${this.manifest.id}:${commandId}`).replace(/\s+/g, "") || null;
		const keyHints: KeyHints = { alternatives: hintFor(HOTKEY_COMMANDS.alternatives), askAi: hintFor(HOTKEY_COMMANDS.askAi), actions: hintFor(HOTKEY_COMMANDS.actions) };
		const current = this.store.getState().keyHints;
		if (keyHints.alternatives !== current.alternatives || keyHints.askAi !== current.askAi || keyHints.actions !== current.actions) this.store.setState({ keyHints });
	}

	switchOptions() {
		return { articleFix: this.settings.articleFix };
	}

	toggleMarkers(view: EditorView) {
		const markersOn = !view.state.field(noteModeField).markersOn;
		view.dispatch({ effects: setNoteMode.of({ markersOn }) });
	}

	findSpots() {
		const view = this.controller.editor;
		if (!view) {
			new Notice("Open a note first.");
			return;
		}
		const title = (this.controller.activePath ?? "").replace(/^.*\//, "").replace(/\.md$/, "");
		void this.aiAlternatives.suggestSpots(view, title);
	}

	removeAllAiVersions() {
		const view = this.controller.editor;
		if (!view) return;
		const removed = this.aiAlternatives.removeAllAiVersions(view);
		new Notice(removed ? `Removed ${removed} AI ${removed === 1 ? "version" : "versions"}.` : "No AI versions in this note.");
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
				setLayout: (layout) => {
					this.settings.lintLayout = layout;
					void this.saveSettings();
				},
				reloadRules: () => void this.linter.reloadRules(),
			},
			lab: {
				setModelMode: (mode) => void this.setModelMode(mode),
				runPass: (passId) => void this.lab.runPass(passId as never),
				findSpots: () => this.findSpots(),
				removeAllAiVersions: () => this.removeAllAiVersions(),
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
				openMenu: (anchor, markCount) => {
					const menu = new Menu();
					menu.addItem((item) =>
						item
							.setTitle(markCount > 0 ? `Clear Lab marks (${markCount})` : "Clear Lab marks")
							.setIcon("eraser")
							.setDisabled(markCount === 0)
							.onClick(() => this.lab.clearMarks()),
					);
					menu.addItem((item) => item.setTitle("Remove all AI versions in note").setIcon("x").onClick(() => this.removeAllAiVersions()));
					menu.addSeparator();
					menu.addItem((item) => item.setTitle("Cost log").setIcon("receipt").onClick(() => this.showCostLog()));
					menu.addItem((item) =>
						item
							.setTitle("Vikalp settings")
							.setIcon("settings")
							.onClick(() => {
								this.labPopover.close();
								const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
								setting?.open();
								setting?.openTabById(this.manifest.id);
							}),
					);
					const rect = anchor.getBoundingClientRect();
					window.setTimeout(() => menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 }), 0);
				},
				close: () => this.labPopover.close(),
			},
			trimPrimary: () => this.settings.trimPrimaryAction,
		};
	}

	notify(message: string) {
		new Notice(message);
	}
}
