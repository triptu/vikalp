// Small helpers for driving Obsidian in e2e flows and screenshot runs.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { launchObsidian } from "./obsidian.mjs";

export async function startSession(options = {}) {
	const session = await launchObsidian(options);
	const { page } = session;
	await page.evaluate(({ width, height }) => {
		try {
			const remote = window.require("@electron/remote");
			const win = remote.getCurrentWindow();
			win.setSize(width, height);
			win.center();
		} catch (error) {
			console.warn("could not resize", error);
		}
	}, { width: options.width ?? 1440, height: options.height ?? 900 });
	await page.waitForTimeout(400);
	return { ...session, driver: createDriver(page) };
}

export function createDriver(page) {
	const driver = {
		page,
		async wait(ms) {
			await page.waitForTimeout(ms);
		},
		async openNote(path) {
			await page.evaluate(async (notePath) => {
				const file = window.app.vault.getAbstractFileByPath(notePath);
				if (!file) throw new Error(`No note at ${notePath}`);
				const leaf = window.app.workspace.getLeaf(false);
				await leaf.openFile(file, { state: { mode: "source" } });
				window.app.workspace.setActiveLeaf(leaf, { focus: true });
			}, path);
			await page.waitForTimeout(700);
		},
		async setTheme(theme) {
			await page.evaluate((mode) => {
				window.app.changeTheme?.(mode);
				window.app.vault.setConfig?.("theme", mode);
				document.body.toggleClass("theme-dark", mode === "obsidian");
				document.body.toggleClass("theme-light", mode === "moonstone");
			}, theme === "dark" ? "obsidian" : "moonstone");
			await page.waitForTimeout(300);
		},
		async command(id) {
			const ran = await page.evaluate((commandId) => window.app.commands.executeCommandById(commandId), id);
			if (!ran) throw new Error(`Command ${id} did not run`);
			await page.waitForTimeout(250);
		},
		/** Selects the nth occurrence of `text` in the active editor. */
		async select(text, occurrence = 0) {
			await page.evaluate(
				({ needle, nth }) => {
					const view = window.app.plugins.plugins.vikalp.controller.editor;
					const doc = view.state.doc.toString();
					let from = -1;
					for (let index = 0; index <= nth; index++) from = doc.indexOf(needle, from + 1);
					if (from < 0) throw new Error(`"${needle}" not found`);
					view.dispatch({ selection: { anchor: from, head: from + needle.length }, scrollIntoView: true });
					view.focus();
				},
				{ needle: text, nth: occurrence },
			);
			await page.waitForTimeout(150);
		},
		async cursorAt(text, offset = 0) {
			await page.evaluate(
				({ needle, delta }) => {
					const view = window.app.plugins.plugins.vikalp.controller.editor;
					const from = view.state.doc.toString().indexOf(needle);
					view.dispatch({ selection: { anchor: from + delta } });
					view.focus();
				},
				{ needle: text, delta: offset },
			);
			await page.waitForTimeout(100);
		},
		async docText() {
			return page.evaluate(() => window.app.plugins.plugins.vikalp.controller.editor?.state.doc.toString());
		},
		async press(key) {
			await page.keyboard.press(key);
			await page.waitForTimeout(150);
		},
		/** Right-clicks the middle of the editor's selection, which opens the editor menu. */
		async rightClickSelection() {
			const point = await page.evaluate(() => {
				const view = window.app.plugins.plugins.vikalp.controller.editor;
				const { from, to } = view.state.selection.main;
				const start = view.coordsAtPos(from);
				const end = view.coordsAtPos(to);
				return { x: (start.left + end.right) / 2, y: (start.top + start.bottom) / 2 };
			});
			await page.mouse.click(point.x, point.y, { button: "right" });
			await page.waitForTimeout(250);
		},
		async type(text) {
			await page.keyboard.type(text, { delay: 15 });
		},
		/** Moves the mouse onto the first element matching the selector (optionally containing text). */
		async hover(selector, text) {
			const locator = text ? page.locator(selector, { hasText: text }).first() : page.locator(selector).first();
			await locator.hover();
			await page.waitForTimeout(200);
		},
		async click(selector, text) {
			const locator = text ? page.locator(selector, { hasText: text }).first() : page.locator(selector).first();
			await locator.click();
			await page.waitForTimeout(250);
		},
		async screenshot(path, options = {}) {
			mkdirSync(dirname(path), { recursive: true });
			await page.waitForTimeout(options.settle ?? 300);
			await page.screenshot({ path, clip: options.clip });
		},
		/** Opens Vikalp's settings tab and returns the page it renders in. Obsidian 1.13 opens settings in their own window. */
		async openSettings() {
			await page.evaluate(() => {
				window.app.setting.open();
				window.app.setting.openTabById("vikalp");
			});
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline) {
				for (const candidate of page.context().browser().contexts().flatMap((context) => context.pages())) {
					const hasSettings = await candidate.evaluate(() => document.querySelector(".vk-settings") !== null).catch(() => false);
					if (hasSettings) return candidate;
				}
				await page.waitForTimeout(200);
			}
			throw new Error("Vikalp settings did not open");
		},
		async evaluate(fn, arg) {
			return page.evaluate(fn, arg);
		},
		async consoleErrors() {
			return page.evaluate(() => window.__vikalpErrors ?? []);
		},
	};
	return driver;
}
