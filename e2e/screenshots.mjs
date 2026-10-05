// Drives the dev vault through the main features and saves screenshots to docs/screenshots/.
// Usage: npm run shots            (dark and light)
//        npm run shots -- dark    (one theme)
import { startSession } from "./driver.mjs";

const ESSAY = "Essays/The cost of the obvious.md";
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
const themes = process.argv[2] ? [process.argv[2]] : ["dark", "light"];
const withAi = !process.argv.includes("--no-ai");

for (const theme of themes) {
	const session = await startSession({});
	const driver = session.driver;
	const shot = (name, options) => driver.screenshot(`${OUT}${theme}-${name}.png`, options);
	try {
		await driver.setTheme(theme);
		// The docs show the suggested hotkeys, so the panels' key hints read ⌘J and ⌘.
		await driver.evaluate(() => window.app.plugins.plugins.vikalp.setSuggestedHotkeys(true));
		await driver.openNote(ESSAY);

		await driver.select("tension");
		await driver.command("vikalp:alternatives-for-selection");
		for (const version of ["pressure", "friction"]) {
			await driver.type(version);
			await driver.press("Enter");
		}
		await shot("01-alternatives-panel");

		await driver.select("thumbtack");
		await driver.command("vikalp:alternatives-for-selection");
		await driver.type("eraser");
		await driver.press("Enter");
		await driver.select("The fix is rarely to delete. Usually it is to move. Put the claim up front. Push the aside down. Give the rare thing a quiet place to live. The piece gets shorter to read without getting shorter to write.");
		await driver.command("vikalp:alternatives-for-selection");
		await driver.type("The fix is rarely to delete. It is to move: the claim up front, the aside down, the rare thing somewhere quiet.");
		await driver.press("Enter");
		await driver.select("ranking");
		await driver.command("vikalp:alternatives-for-selection");
		await driver.type("sorting");
		await driver.press("Enter");
		await driver.click(".vk-span-more");
		await driver.click(".menu-item", "Add a note");
		await driver.type("too abstract?");
		await driver.press("Enter");
		await driver.press("Escape");
		await driver.select("A clever aside, a second example, a sentence I like the sound of.");
		await driver.command("vikalp:ghost-selection");
		await driver.select("This isn't the same as prioritizing a backlog.");
		await driver.command("vikalp:stash-selection");
		await driver.cursorAt("Writing works");
		await driver.hover(".vk-span", "friction");
		await shot("02-markers-ghost-overflow");

		await driver.hover(".vk-span", "sorting");
		await driver.wait(700);
		await shot("03-span-note");

		if (withAi) {
			await driver.select("friction");
			await driver.command("vikalp:ai-alternatives-for-selection");
			await driver.page.waitForFunction(() => window.app.plugins.plugins.vikalp.store.getState().aiPendingSpans.length === 0, null, { timeout: 60000 });
			await shot("04-ai-alternatives");
		}

		await driver.openNote("Essays/LinkedIn draft.md");
		await driver.command("vikalp:run-linter");
		await driver.page.waitForFunction(() => !window.app.plugins.plugins.vikalp.store.getState().lint.running, null, { timeout: 60000 });
		await driver.hover(".vk-lint");
		await driver.wait(700);
		await shot("05-linter");

		if (withAi) {
			await driver.openNote("Typos and tone.md");
			await driver.click(".vk-status-lab");
			await shot("06-lab");
			await driver.click(".vk-lab-pass", "Typos and punctuation");
			await driver.page.waitForFunction(() => window.app.plugins.plugins.vikalp.store.getState().lab.runningPass === null, null, { timeout: 60000 });
			await driver.press("Escape");
			await driver.hover(".vk-lint-lab");
			await driver.wait(700);
			await shot("07-typo-pass");

			await driver.openNote(ESSAY);
			await driver.click(".vk-status-lab");
			await driver.click(".vk-segment", "Slight");
			await driver.page.waitForFunction(() => window.app.plugins.plugins.vikalp.store.getState().trim.status !== "reading", null, { timeout: 90000 });
			await shot("08-trim");
			await driver.click(".vk-trim-bar button", "Done");
		}

		await driver.openNote(ESSAY);
		await driver.command("vikalp:read-through");
		await driver.wait(500);
		await shot("09-read-through");
		await driver.press("Escape");
		console.log(`${theme}: done`);
	} catch (error) {
		console.log(`${theme}: ${error.message}`);
		await shot("error");
	} finally {
		await session.close();
	}
}
process.exit(0);
