// End-to-end flows from the spec, run against a real (isolated) Obsidian on a scratch copy of the dev vault.
// Flows are grouped so each group shares one Obsidian and one scratch vault; a group runs its flows in order.
// AI answers are replayed from e2e/ai-recordings.json; requests with no recording go to the model and get saved.
// Usage: npm run e2e                (all groups)
//        npm run e2e -- ghost       (groups with a flow whose name contains "ghost")
//        npm run e2e -- --live      (ask the model again and refresh the recordings)
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { prepareScratchVault } from "./obsidian.mjs";
import { startSession } from "./driver.mjs";
import { RECORDINGS_PATH, aiStats, useAiRecordings } from "./aiRecordings.mjs";
import { startMockModelServer } from "../tests/support/mockModelServer.ts";

const ESSAY = "Essays/The cost of the obvious.md";
const args = process.argv.slice(2);
const live = args.includes("--live");
const filter = args.find((arg) => !arg.startsWith("--")) ?? "";
const results = [];
const ai = { replayed: 0, recorded: 0 };

function assert(condition, message) {
	if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const plugin = (driver, fn, arg) => driver.evaluate(fn, arg);

async function noteState(driver) {
	return plugin(driver, () => window.app.plugins.plugins.vikalp.store.getState().note);
}

const flow = (name, run) => ({ name, run });

/** Closes Obsidian, runs `between` on the scratch vault, and opens Obsidian again for the next flow. */
const restart = (between) => ({ restart: true, between });

async function openObsidian() {
	const session = await startSession({ keepVault: true });
	session.pageErrors = [];
	session.page.on("pageerror", (error) => session.pageErrors.push(error.message));
	await useAiRecordings(session.page, { live });
	return session;
}

async function closeObsidian(session) {
	const stats = await aiStats(session.page);
	ai.replayed += stats.replayed;
	ai.recorded += stats.recorded;
	await session.close();
}

async function group(title, steps) {
	const names = steps.filter((step) => step.name).map((step) => step.name);
	if (filter && !title.includes(filter) && !names.some((name) => name.includes(filter))) return;
	console.log(`\n${title}`);
	const vault = prepareScratchVault();
	let session = null;
	try {
		for (const step of steps) {
			if (step.restart) {
				if (session) {
					await session.driver.wait(1000);
					await closeObsidian(session);
					session = null;
				}
				step.between?.(vault);
				continue;
			}
			const started = Date.now();
			try {
				session ??= await openObsidian();
				await step.run(session.driver);
				const pageErrors = session.pageErrors.splice(0);
				assert(pageErrors.length === 0, `no page errors, got: ${pageErrors.join(" | ")}`);
				results.push({ name: step.name, ok: true });
				console.log(`  ✓ ${step.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
			} catch (error) {
				session?.pageErrors.splice(0);
				results.push({ name: step.name, ok: false });
				console.log(`  ✗ ${step.name}\n      ${error.message}`);
			}
		}
	} finally {
		if (session) await closeObsidian(session);
	}
}

const runStarted = Date.now();
console.log(`Vikalp e2e${live ? " (live AI)" : ""}`);
if (live && !filter) rmSync(RECORDINGS_PATH, { force: true });

await group("Writing, then a restart", [
	flow("alternatives: create, cycle by hover, undo", async (driver) => {
		await driver.openNote(ESSAY);
		await driver.select("tension");
		await driver.command("vikalp:alternatives-for-selection");
		await driver.type("pressure");
		await driver.press("Enter");
		await driver.type("friction");
		await driver.press("Enter");
		await driver.press("Escape");
		assert((await driver.docText()).includes("Much of the friction in"), "new version shows in place");

		await driver.hover(".vk-span", "friction");
		await driver.press("ArrowLeft");
		assert((await driver.docText()).includes("Much of the pressure in"), "arrow while hovering cycles back");
		await driver.press("ArrowRight");
		await driver.press("ArrowRight");
		assert((await driver.docText()).includes("Much of the tension in"), "cycling wraps to the original");

		await driver.press("Meta+z");
		assert((await driver.docText()).includes("Much of the friction in"), "undo reverses the swap");
		const dots = await driver.evaluate(() => document.querySelectorAll(".vk-dots .vk-dot").length);
		assert(dots === 3, `three dots for three versions, saw ${dots}`);
	}),

	flow("ghost: dims text, copy clean leaves it out, revive brings it back", async (driver) => {
		await driver.openNote(ESSAY);
		const sentence = "A clever aside, a second example, a sentence I like the sound of.";
		await driver.select(sentence);
		await driver.command("vikalp:ghost-selection");
		const ghosted = await driver.evaluate(() => document.querySelector(".vk-ghost")?.textContent);
		assert(ghosted === sentence, "the sentence renders as a ghost");
		const note = await noteState(driver);
		assert(note.ghostWords === 13, `status bar counts 13 ghosted words, saw ${note.ghostWords}`);

		await driver.command("vikalp:copy-clean-text");
		const clipboard = await driver.evaluate(() => window.require("electron").clipboard.readText());
		assert(!clipboard.includes("A clever aside"), "clean copy leaves the ghost out");
		assert(clipboard.includes("good things. They are not wrong."), "and tidies the spacing");

		await driver.cursorAt("clever aside", 3);
		await driver.command("vikalp:revive");
		assert((await driver.evaluate(() => document.querySelectorAll(".vk-ghost").length)) === 0, "revive removes the ghost");
	}),

	flow("overflow: stash a paragraph, drag it back, Overflow is empty", async (driver) => {
		await driver.openNote(ESSAY);
		const paragraph = "This isn't the same as prioritizing a backlog.";
		await driver.select(paragraph);
		await driver.command("vikalp:stash-selection");
		assert(!(await driver.docText()).includes(paragraph), "stashing removes the text");
		let note = await noteState(driver);
		assert(note.overflow.length === 1 && note.overflow[0].text === paragraph, "and adds it to Overflow");

		const block = driver.page.locator(".vk-overflow-block").first();
		const target = driver.page.locator(".cm-line", { hasText: "Writing works the same way" }).first();
		await block.dragTo(target, { targetPosition: { x: 4, y: 8 } });
		await driver.wait(400);
		note = await noteState(driver);
		assert(note.overflow.length === 0, "dragging the block into the note empties Overflow");
		assert((await driver.docText()).includes(paragraph), "and puts the text back");
	}),

	flow("unit tabs switch the panel between word, sentence and paragraph", async (driver) => {
		await driver.openNote(ESSAY);
		await driver.select("rarely");
		await driver.command("vikalp:alternatives-for-selection");
		await driver.type("seldom");
		await driver.press("Enter");
		const activeTab = () => driver.evaluate(() => document.querySelector(".vk-unit-switch .is-active")?.textContent);
		await driver.click(".vk-unit-switch .vk-segment", "Sentence");
		await driver.wait(300);
		assert((await activeTab()) === "Sentence", `Sentence tab is active (saw ${await activeTab()})`);
		await driver.type("A shorter sentence.");
		await driver.press("Enter");
		await driver.click(".vk-unit-switch .vk-segment", "Paragraph");
		await driver.wait(300);
		assert((await activeTab()) === "Paragraph", "Paragraph tab is active");
		await driver.click(".vk-unit-switch .vk-segment", "Sentence");
		await driver.wait(300);
		assert((await activeTab()) === "Sentence", "back to Sentence, reusing the existing sentence");
		const versions = await driver.evaluate(() => [...document.querySelectorAll(".vk-version-text")].map((element) => element.textContent));
		assert(versions.includes("A shorter sentence."), "the sentence keeps its versions");
		await driver.click(".vk-unit-switch .vk-segment", "Word");
		await driver.wait(300);
		assert((await activeTab()) === "Word", "back to Word");
		await driver.press("Escape");
	}),

	flow("keys: off until turned on in settings; then ⌘J widens word to sentence to paragraph, ⌘. then G ghosts", async (driver) => {
		await driver.openNote(ESSAY);
		const defaultKeys = await driver.evaluate(() => window.app.hotkeyManager.getDefaultHotkeys("vikalp:alternatives-for-selection") ?? []);
		assert(defaultKeys.length === 0, "Vikalp takes no hotkeys until asked");
		const settings = await driver.openSettings();
		await settings.locator(".setting-item.mod-toggle", { hasText: "Use suggested hotkeys" }).locator(".checkbox-container").click();
		await driver.wait(300);
		await driver.evaluate(() => window.app.setting.close());
		await driver.wait(300);
		await driver.cursorAt("hardest", 3);
		const unit = () => driver.evaluate(() => document.querySelector(".vk-unit-switch .is-active")?.textContent);
		await driver.press("Meta+j");
		await driver.wait(300);
		assert((await unit()) === "Word", "⌘J opens the word");
		await driver.press("Meta+j");
		await driver.wait(300);
		assert((await unit()) === "Sentence", "⌘J again widens to the sentence");
		await driver.press("Meta+j");
		await driver.wait(300);
		assert((await unit()) === "Paragraph", "and again to the paragraph");
		await driver.press("Escape");
		await driver.select("A clever aside");
		await driver.press("Meta+.");
		await driver.wait(200);
		assert(await driver.evaluate(() => Boolean(document.querySelector(".vk-action-menu"))), "⌘. opens the action menu");
		await driver.press("g");
		await driver.wait(200);
		assert((await driver.evaluate(() => document.querySelectorAll(".vk-ghost").length)) === 1, "G ghosts the selection");
	}),

	flow("span notes: add a note to a span", async (driver) => {
		await driver.openNote(ESSAY);
		await driver.select("ranking");
		await driver.command("vikalp:alternatives-for-selection");
		await driver.type("sorting");
		await driver.press("Enter");
		await driver.click(".vk-span-more");
		await driver.click(".menu-item", "Add a note");
		await driver.type("too abstract?");
		await driver.press("Enter");
		await driver.press("Escape");
		const note = await noteState(driver);
		assert(note.spans.some((span) => span.note === "too abstract?"), "the span has the note");
	}),

	flow("anchoring: add a span that the file edit below must not lose", async (driver) => {
		await driver.openNote(ESSAY);
		await driver.select("thumbtack");
		await driver.command("vikalp:alternatives-for-selection");
		await driver.type("corkboard");
		await driver.press("Enter");
		await driver.press("Escape");
		assert((await driver.docText()).includes("like a corkboard board"), "the new version shows in place");
	}),

	flow("two panes on one note stay in step", async (driver) => {
		await driver.openNote(ESSAY);
		await driver.evaluate(async (path) => {
			const leaf = window.app.workspace.getLeaf("split");
			await leaf.openFile(window.app.vault.getAbstractFileByPath(path));
		}, ESSAY);
		await driver.wait(800);
		await driver.select("door");
		await driver.command("vikalp:alternatives-for-selection");
		await driver.type("gate");
		await driver.press("Enter");
		await driver.press("Escape");
		await driver.wait(1200);
		const panes = await driver.evaluate(() => {
			const views = window.app.plugins.plugins.vikalp.controller.allEditors();
			return views.map((view) => ({
				text: view.state.doc.toString().includes("behind a gate"),
				drawn: [...view.dom.querySelectorAll(".vk-span")].some((element) => element.textContent === "gate"),
			}));
		});
		assert(panes.length === 2, `two editors open, saw ${panes.length}`);
		assert(panes.every((pane) => pane.text), "both panes show the new version");
		assert(panes.every((pane) => pane.drawn), "both panes draw the span");
		await driver.evaluate(() => window.app.workspace.getLeavesOfType("markdown").slice(1).forEach((leaf) => leaf.detach()));
	}),

	restart((vault) => {
		const file = resolve(vault, ESSAY);
		const original = readFileSync(file, "utf8");
		writeFileSync(file, original.replace("# The Cost of the Obvious\n", "# The Cost of the Obvious\n\nA new opening paragraph, written in another app.\n"));
	}),

	flow("restart: alternatives, notes and spans from both panes are saved, and re-attach after an outside edit", async (driver) => {
		await driver.openNote(ESSAY);
		await driver.wait(500);
		assert((await driver.docText()).includes("written in another app"), "the note has the outside edit");
		const note = await noteState(driver);
		const intact = (text, versions) => {
			const span = note.spans.find((candidate) => candidate.text === text);
			return span && !span.orphaned && span.versions.length === versions;
		};
		assert(intact("friction", 3), "the alternatives span keeps all three versions");
		assert(intact("corkboard", 2), "the anchoring span found its text again");
		assert(intact("gate", 2), "the span made with two panes open is intact");
		assert(note.spans.some((span) => span.note === "too abstract?"), "the span note survives");
		const noteDots = await driver.evaluate(() => window.app.plugins.plugins.vikalp.controller.editor.dom.querySelectorAll(".vk-note-dot").length);
		assert(noteDots === 1, `with its marker dot, saw ${noteDots}`);
	}),

	flow("read-through hides every marker until Esc", async (driver) => {
		await driver.command("vikalp:read-through");
		const hidden = await driver.evaluate(() => document.querySelectorAll(".vk-span, .vk-dots, .vk-lint").length);
		assert(hidden === 0, "read-through hides every marker");
		await driver.press("Escape");
		await driver.wait(200);
		const back = await driver.evaluate(() => document.querySelectorAll(".vk-span").length);
		assert(back > 0, "markers come back after Esc");
	}),
]);

await group("Linter, settings and AI", [
	flow("linter: rules mark the LinkedIn draft, the note and its paragraphs; marks and the list stay linked", async (driver) => {
		await driver.openNote("Essays/LinkedIn draft.md");
		await driver.command("vikalp:toggle-lint");
		await driver.command("vikalp:run-linter");
		await driver.page.waitForFunction(() => !window.app.plugins.plugins.vikalp.store.getState().lint.running, null, { timeout: 90000 });
		const hits = (await noteState(driver)).lintHits;
		const labels = new Set(hits.map((hit) => hit.label));
		for (const expected of ["AI-sounding", "Wordy", "Hedging", "LinkedIn voice"]) {
			assert([...labels].some((label) => label.toLowerCase() === expected.toLowerCase()), `"${expected}" is among the hits (${[...labels].join(", ")})`);
		}
		const marked = await driver.evaluate(() => document.querySelectorAll(".vk-lint").length);
		assert(marked > 3, "hits are highlighted in the editor");

		const linkedin = hits.filter((hit) => hit.ruleId === "linkedin-voice.post");
		assert(linkedin.filter((hit) => hit.scope === "document").length === 1, "the whole note is flagged once as LinkedIn");
		const paragraphs = linkedin.filter((hit) => hit.scope === "paragraph").length;
		assert(paragraphs >= 2, `and the paragraphs behind it are marked (${paragraphs})`);

		await driver.click(".vk-lint-layout .vk-segment:nth-child(2)");
		const order = await driver.evaluate(() => {
			const note = window.app.plugins.plugins.vikalp.store.getState().note;
			const byId = new Map(note.lintHits.map((hit) => [hit.id, hit.from]));
			return [...document.querySelectorAll(".vk-hit-list .vk-hit")].map((row) => byId.get(row.dataset.hit));
		});
		assert(order.length > 3 && order.every((from, index) => index === 0 || order[index - 1] <= from), "the flat list is in text order");
		const mark = driver.page.locator(".cm-content .vk-lint").last();
		await mark.scrollIntoViewIfNeeded();
		await mark.click();
		await driver.wait(300);
		assert(await driver.evaluate(() => Boolean(document.querySelector(".vk-hit.is-revealed"))), "clicking a mark reveals its row");

		await driver.command("vikalp:clear-lint");
		assert((await noteState(driver)).lintHits.length === 0, "clear removes every mark");
	}),

	flow("settings: rules are grouped, and a new rule added in the editor flags text", async (driver) => {
		await driver.openNote("Essays/LinkedIn draft.md");
		const settings = await driver.openSettings();
		await driver.wait(600);
		const familyNames = await settings.evaluate(() => [...document.querySelectorAll(".vk-rule-family .setting-item-name")].map((element) => element.firstChild?.textContent));
		assert(familyNames.filter((name) => name === "Hedging").length === 1, "Hedging shows once, as a family");
		await settings.locator(".setting-item button", { hasText: "Add rule" }).first().click();
		await settings.locator(".vk-rule-editor input[type=text]").first().fill("Corporate speak");
		await settings.locator(".vk-rule-editor textarea").first().fill("synergies\nmove the needle");
		await driver.wait(500);
		const preview = await settings.evaluate(() => document.querySelector(".vk-rule-preview")?.textContent ?? "");
		assert(preview.includes("2 marks"), `the editor previews hits on the open note (${preview})`);
		await settings.locator(".vk-rule-editor button", { hasText: "Add rule" }).first().click();
		await driver.wait(600);
		const listed = await settings.evaluate(() => [...document.querySelectorAll(".vk-rule-family .setting-item-name")].some((element) => element.firstChild?.textContent === "Corporate speak"));
		assert(listed, "the new rule shows in settings straight away");
		await driver.evaluate(() => window.app.setting.close());
		await driver.command("vikalp:run-linter");
		await driver.page.waitForFunction(() => !window.app.plugins.plugins.vikalp.store.getState().lint.running, null, { timeout: 60000 });
		const labels = (await noteState(driver)).lintHits.map((hit) => hit.label);
		assert(labels.filter((label) => label === "Corporate speak").length === 2, "the new rule marks both phrases");
	}),

	flow("editing while AI rules run never breaks the editor", async (driver) => {
		await driver.openNote("Essays/LinkedIn draft.md");
		await driver.command("vikalp:run-linter");
		await driver.wait(300);
		await driver.select("The report was written by the team and was reviewed by me, which was really very helpful.\n\nAgree?");
		await driver.press("Backspace");
		await driver.page.waitForFunction(() => !window.app.plugins.plugins.vikalp.store.getState().lint.running, null, { timeout: 60000 });
		await driver.cursorAt("I'm humbled");
		await driver.type("Truly, ");
		const doc = await driver.docText();
		assert(doc.startsWith("# What I learned") && doc.includes("Truly, I'm humbled"), "typing still works after late results arrive");
		const outOfRange = await driver.evaluate(() => {
			const note = window.app.plugins.plugins.vikalp.store.getState().note;
			const length = window.app.plugins.plugins.vikalp.controller.editor.state.doc.length;
			return note.lintHits.filter((hit) => hit.from > length).length;
		});
		assert(outOfRange === 0, "no mark points past the end of the note");
	}),

	flow("find words worth playing with: one click adds AI versions at several spots", async (driver) => {
		await driver.openNote(ESSAY);
		const before = await driver.docText();
		await driver.command("vikalp:find-spots");
		await driver.page.waitForFunction(() => window.app.plugins.plugins.vikalp.store.getState().lab.runningPass === null, null, { timeout: 90000 });
		const note = await noteState(driver);
		const spotted = note.spans.filter((span) => span.versions.some((version) => version.source === "ai"));
		assert(spotted.length >= 3, `at least three spots got AI versions (${spotted.length}: ${spotted.map((span) => span.text).join(", ")})`);
		assert((await driver.docText()) === before, "the note text did not change");
		const underlines = await driver.evaluate(() => document.querySelectorAll(".vk-span").length);
		assert(underlines >= 3, "the spots are marked in the note");
		await driver.command("vikalp:remove-all-ai-alternatives");
		assert((await noteState(driver)).spans.length === 0, "removing AI versions clears the spots");
	}),

]);

// A stand-in for Ollama, so the renderer's real requests (CORS, the OpenAI client in the browser) are tested without one installed.
const localServer = await startMockModelServer(["tiny-local:1b", "other:3b"]);
localServer.toolArguments = { alternatives: [{ text: "pressure" }, { text: "strain" }] };

/** The settings row with exactly this name. */
const settingRow = (settings, name) => settings.locator(".setting-item", { has: settings.locator(".setting-item-name", { hasText: new RegExp(`^${name}$`) }) }).first();

async function waitForRowText(settings, name, text) {
	await settings.waitForFunction(
		({ rowName, expected }) => [...document.querySelectorAll(".setting-item")].some((row) => row.querySelector(".setting-item-name")?.textContent === rowName && row.textContent.includes(expected)),
		{ rowName: name, expected: text },
		{ timeout: 10000 },
	);
}

await group("AI providers", [
	flow("a model on this computer: Ollama lists its models, Ask AI uses the one picked, and it costs nothing", async (driver) => {
		// Recordings are keyed by prompt, not model, so this flow talks to the server for real.
		await driver.evaluate(() => delete window.app.plugins.plugins.vikalp.ai.structured);
		await driver.openNote(ESSAY);
		const settings = await driver.openSettings();
		await settingRow(settings, "Provider").locator("select:not(.is-measuring)").selectOption("ollama");
		await settings.waitForTimeout(400);
		assert((await settingRow(settings, "OpenRouter API key").count()) === 0, "Ollama asks for no key");

		await settingRow(settings, "Server URL").locator("input").fill("http://localhost:9/v1");
		await settingRow(settings, "Server URL").locator("input").press("Tab");
		await waitForRowText(settings, "Model", "Can't reach localhost:9. Is Ollama running?");

		await settingRow(settings, "Server URL").locator("input").fill(localServer.baseUrl);
		await settingRow(settings, "Server URL").locator("input").press("Tab");
		await waitForRowText(settings, "Model", "Connected. 2 models on the server.");
		await settingRow(settings, "Model").locator("select:not(.is-measuring)").selectOption("other:3b");
		await settings.waitForTimeout(400);
		await driver.evaluate(() => window.app.setting.close());

		const status = await driver.evaluate(() => document.querySelector(".vk-status-lab-mode")?.textContent);
		assert(status === "other:3b", `the status bar names the model (${status})`);
		await driver.click(".vk-status-lab");
		const lab = await driver.evaluate(() => ({ model: document.querySelector(".vk-lab-model")?.textContent, modes: document.querySelectorAll(".vk-lab-mode").length, cost: document.querySelector(".vk-lab-footer-end .vk-inline-action")?.textContent }));
		assert(lab.model === "other:3b" && lab.modes === 0, `the Lab names the model instead of offering modes (${JSON.stringify(lab)})`);
		assert(lab.cost === "Free", `the Lab says it's free (${lab.cost})`);
		await driver.press("Escape");

		await driver.select("obvious");
		await driver.command("vikalp:ai-alternatives-for-selection");
		await driver.page.waitForFunction(() => window.app.plugins.plugins.vikalp.store.getState().aiPendingSpans.length === 0, null, { timeout: 30000 });
		const versions = (await noteState(driver)).spans.flatMap((span) => span.versions.filter((version) => version.source === "ai").map((version) => version.text));
		assert(versions.includes("pressure") && versions.includes("strain"), `the server's versions were added (${versions.join(", ")})`);
		const request = localServer.requests.at(-1);
		assert(request?.model === "other:3b", `the request went to the picked model (${request?.model})`);
		assert(request?.origin === "app://obsidian.md", `it came from Obsidian's renderer (${request?.origin})`);
	}),

	flow("switching back to OpenRouter keeps its key and brings back the modes", async (driver) => {
		const settings = await driver.openSettings();
		await settingRow(settings, "Provider").locator("select:not(.is-measuring)").selectOption("openrouter");
		await settings.waitForTimeout(400);
		const keyField = settingRow(settings, "OpenRouter API key").locator("input");
		assert((await keyField.getAttribute("placeholder")) === "Key saved", "the OpenRouter key is still there");
		assert((await keyField.inputValue()) === "", "and the page never shows it");
		const dataJson = await driver.evaluate(async () => JSON.stringify(await window.app.plugins.plugins.vikalp.loadData()));
		assert(!dataJson.includes("apiKey"), "data.json holds no key");
		assert((await settingRow(settings, "Lite model").count()) === 1, "Lite, Medium and Heavy are back");
		await driver.evaluate(() => window.app.setting.close());
		const state = await driver.evaluate(() => {
			const store = window.app.plugins.plugins.vikalp.store.getState();
			return { hint: store.aiSetupHint, label: document.querySelector(".vk-status-lab-mode")?.textContent };
		});
		assert(state.hint === null && state.label === "Lite", `AI is ready on Lite (${JSON.stringify(state)})`);
	}),
]);
await localServer.close();

const failed = results.filter((result) => !result.ok);
const seconds = ((Date.now() - runStarted) / 1000).toFixed(0);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed in ${seconds}s`);
console.log(`AI: ${ai.replayed} replayed, ${ai.recorded} asked live and recorded`);
process.exit(failed.length ? 1 : 0);
