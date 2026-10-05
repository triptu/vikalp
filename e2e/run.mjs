// End-to-end flows from the spec, run against a real (isolated) Obsidian on a scratch copy of the dev vault.
// Usage: npm run e2e            (all flows)
//        npm run e2e -- ghost   (flows whose name contains "ghost")
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareScratchVault } from "./obsidian.mjs";
import { startSession } from "./driver.mjs";

const ESSAY = "Essays/The cost of the obvious.md";
const filter = process.argv[2] ?? "";
const results = [];

function assert(condition, message) {
	if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const plugin = (driver, fn, arg) => driver.evaluate(fn, arg);

async function noteState(driver) {
	return plugin(driver, () => window.app.plugins.plugins.vikalp.store.getState().note);
}

async function flow(name, run) {
	if (filter && !name.includes(filter)) return;
	const started = Date.now();
	try {
		await run();
		results.push({ name, ok: true, ms: Date.now() - started });
		console.log(`  ✓ ${name}`);
	} catch (error) {
		results.push({ name, ok: false, error: error.message });
		console.log(`  ✗ ${name}\n      ${error.message}`);
	}
}

async function withObsidian(options, run) {
	const session = await startSession(options);
	const pageErrors = [];
	session.page.on("pageerror", (error) => pageErrors.push(error.message));
	try {
		await run(session.driver);
		assert(pageErrors.length === 0, `no page errors, got: ${pageErrors.join(" | ")}`);
	} finally {
		await session.close();
	}
}

console.log("Vikalp e2e");

await flow("alternatives: create, cycle by hover, undo, survive a restart", async () => {
	prepareScratchVault();
	await withObsidian({ keepVault: true }, async (driver) => {
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
		await driver.wait(800);
	});
	await withObsidian({ keepVault: true }, async (driver) => {
		await driver.openNote(ESSAY);
		await driver.wait(500);
		const note = await noteState(driver);
		const span = note.spans.find((candidate) => candidate.text === "friction");
		assert(span, "span is still there after restarting Obsidian");
		assert(span.versions.length === 3, "with all three versions");
	});
});

await flow("ghost: dims text, copy clean leaves it out, revive brings it back", async () => {
	await withObsidian({}, async (driver) => {
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
	});
});

await flow("overflow: stash a paragraph, drag it back, Overflow is empty", async () => {
	await withObsidian({}, async (driver) => {
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
	});
});

await flow("linter: local and judgment rules mark the LinkedIn draft", async () => {
	await withObsidian({}, async (driver) => {
		await driver.openNote("Essays/LinkedIn draft.md");
		await driver.command("vikalp:run-linter");
		await driver.page.waitForFunction(() => !window.app.plugins.plugins.vikalp.store.getState().lint.running, null, { timeout: 60000 });
		const labels = new Set((await noteState(driver)).lintHits.map((hit) => hit.label));
		for (const expected of ["AI-sounding", "Wordy", "Hedging", "LinkedIn voice"]) {
			assert([...labels].some((label) => label.toLowerCase() === expected.toLowerCase()), `"${expected}" is among the hits (${[...labels].join(", ")})`);
		}
		const marked = await driver.evaluate(() => document.querySelectorAll(".vk-lint").length);
		assert(marked > 3, "hits are highlighted in the editor");
		await driver.command("vikalp:clear-lint");
		assert((await noteState(driver)).lintHits.length === 0, "clear removes every mark");
	});
});

await flow("anchoring: spans re-attach after the file is edited outside Obsidian", async () => {
	const vault = prepareScratchVault();
	await withObsidian({ keepVault: true }, async (driver) => {
		await driver.openNote(ESSAY);
		await driver.select("thumbtack");
		await driver.command("vikalp:alternatives-for-selection");
		await driver.type("corkboard");
		await driver.press("Enter");
		await driver.press("Escape");
		await driver.wait(900);
	});
	const file = resolve(vault, ESSAY);
	const original = readFileSync(file, "utf8");
	writeFileSync(file, original.replace("# The Cost of the Obvious\n", "# The Cost of the Obvious\n\nA new opening paragraph, written in another app.\n"));
	await withObsidian({ keepVault: true }, async (driver) => {
		await driver.openNote(ESSAY);
		await driver.wait(600);
		const note = await noteState(driver);
		const span = note.spans.find((candidate) => candidate.versions.some((version) => version.text === "corkboard"));
		assert(span && span.text === "corkboard" && !span.orphaned, "the span found its text again");
	});
});

await flow("span notes and read-through mode", async () => {
	prepareScratchVault();
	await withObsidian({ keepVault: true }, async (driver) => {
		await driver.openNote(ESSAY);
		await driver.select("ranking");
		await driver.command("vikalp:alternatives-for-selection");
		await driver.type("sorting");
		await driver.press("Enter");
		await driver.click(".vk-note-field input");
		await driver.type("too abstract?");
		await driver.press("Enter");
		await driver.press("Escape");
		await driver.wait(900);
	});
	await withObsidian({ keepVault: true }, async (driver) => {
		await driver.openNote(ESSAY);
		await driver.wait(500);
		const note = await noteState(driver);
		assert(note.spans.some((span) => span.note === "too abstract?"), "the note survives a restart");
		assert((await driver.evaluate(() => document.querySelectorAll(".vk-note-dot").length)) === 1, "with its marker dot");

		await driver.command("vikalp:read-through");
		const hidden = await driver.evaluate(() => document.querySelectorAll(".vk-span, .vk-dots, .vk-lint").length);
		assert(hidden === 0, "read-through hides every marker");
		await driver.press("Escape");
		await driver.wait(200);
		const back = await driver.evaluate(() => document.querySelectorAll(".vk-span").length);
		assert(back > 0, "markers come back after Esc");
	});
});

await flow("two panes on one note stay in step and save the same alternatives", async () => {
	prepareScratchVault();
	await withObsidian({ keepVault: true }, async (driver) => {
		await driver.openNote(ESSAY);
		await driver.evaluate(async () => {
			const leaf = window.app.workspace.getLeaf("split");
			await leaf.openFile(window.app.vault.getAbstractFileByPath("Essays/The cost of the obvious.md"));
		});
		await driver.wait(800);
		await driver.select("tension");
		await driver.command("vikalp:alternatives-for-selection");
		await driver.type("pressure");
		await driver.press("Enter");
		await driver.press("Escape");
		await driver.wait(1200);
		const panes = await driver.evaluate(() => {
			const views = window.app.plugins.plugins.vikalp.controller.allEditors();
			return views.map((view) => ({
				text: view.state.doc.toString().includes("Much of the pressure"),
				underlines: view.dom.querySelectorAll(".vk-span").length,
			}));
		});
		assert(panes.length === 2, `two editors open, saw ${panes.length}`);
		assert(panes.every((pane) => pane.text), "both panes show the new version");
		assert(panes.every((pane) => pane.underlines === 1), `both panes draw the span (${panes.map((pane) => pane.underlines).join(", ")})`);
	});
	await withObsidian({ keepVault: true }, async (driver) => {
		await driver.openNote(ESSAY);
		await driver.wait(500);
		const note = await noteState(driver);
		const span = note.spans.find((candidate) => candidate.text === "pressure");
		assert(span && !span.orphaned && span.versions.length === 2, "the saved span is intact after a restart");
	});
});

await flow("editing while judgment rules run never breaks the editor", async () => {
	await withObsidian({}, async (driver) => {
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
	});
});

await flow("settings: rules are grouped, and a new rule added in the editor flags text", async () => {
	await withObsidian({}, async (driver) => {
		await driver.openNote("Essays/LinkedIn draft.md");
		await driver.evaluate(() => {
			window.app.setting.open();
			window.app.setting.openTabById("vikalp");
		});
		await driver.wait(600);
		const familyNames = await driver.evaluate(() => [...document.querySelectorAll(".vk-rule-family .setting-item-name")].map((element) => element.firstChild?.textContent));
		assert(familyNames.filter((name) => name === "Hedging").length === 1, "Hedging shows once, as a family");
		await driver.click(".setting-item button", "Add rule");
		await driver.page.locator(".vk-rule-editor input[type=text]").first().fill("Corporate speak");
		await driver.page.locator(".vk-rule-editor textarea").first().fill("synergies\nmove the needle");
		await driver.wait(500);
		const preview = await driver.evaluate(() => document.querySelector(".vk-rule-preview")?.textContent ?? "");
		assert(preview.includes("2 marks"), `the editor previews hits on the open note (${preview})`);
		await driver.click(".vk-rule-editor button", "Add rule");
		await driver.wait(600);
		await driver.press("Escape");
		await driver.command("vikalp:run-linter");
		await driver.page.waitForFunction(() => !window.app.plugins.plugins.vikalp.store.getState().lint.running, null, { timeout: 60000 });
		const labels = (await noteState(driver)).lintHits.map((hit) => hit.label);
		assert(labels.filter((label) => label === "Corporate speak").length === 2, "the new rule marks both phrases");
	});
});

await flow("find words worth playing with: one click adds AI versions at several spots", async () => {
	await withObsidian({}, async (driver) => {
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
	});
});

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
