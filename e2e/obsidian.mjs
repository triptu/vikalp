// Launches an isolated Obsidian instance on the dev vault and connects to it over CDP.
// Uses its own user-data dir so Tushar's running Obsidian and real vault are never touched.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const OBSIDIAN_BINARY = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const PROFILE_DIR = resolve(REPO_ROOT, "e2e/.profile");
const DEBUG_PORT = 9333;

/**
 * Copies the dev vault to a scratch folder so runs never change the checked-in
 * notes. `keepVault` reuses the previous copy, to test state across restarts.
 */
export function prepareScratchVault({ keepVault = false } = {}) {
	const source = resolve(REPO_ROOT, "dev-vault");
	const target = resolve(REPO_ROOT, "e2e/.artifacts/vault");
	if (keepVault && existsSync(target)) return target;
	rmSync(target, { recursive: true, force: true });
	cpSync(source, target, {
		recursive: true,
		filter: (path) => !/workspace(-mobile)?\.json$|\/notes(\/|$)|\/trash(\/|$)|\/plugins\/vikalp\/rules(\/|$)/.test(path.slice(source.length)),
	});
	return target;
}

export async function launchObsidian({ vaultPath, keepVault = false, freshProfile = false } = {}) {
	// A test instance left over from a crashed run would answer on the debug port with stale code.
	spawnSync("pkill", ["-9", "-f", `user-data-dir=${PROFILE_DIR}`]);
	await new Promise((done) => setTimeout(done, 500));
	vaultPath = vaultPath ?? prepareScratchVault({ keepVault });
	if (freshProfile) rmSync(PROFILE_DIR, { recursive: true, force: true });
	mkdirSync(PROFILE_DIR, { recursive: true });
	writeFileSync(
		resolve(PROFILE_DIR, "obsidian.json"),
		JSON.stringify({ vaults: { vikalpdev0000000: { path: vaultPath, ts: Date.now(), open: true } }, updateDisabled: true }),
	);
	const child = spawn(OBSIDIAN_BINARY, [`--user-data-dir=${PROFILE_DIR}`, `--remote-debugging-port=${DEBUG_PORT}`], {
		stdio: ["ignore", "pipe", "pipe"],
		detached: false,
	});
	const logs = [];
	child.stdout.on("data", (chunk) => logs.push(String(chunk)));
	child.stderr.on("data", (chunk) => logs.push(String(chunk)));

	const browser = await connectWithRetry();
	const page = await findVaultPage(browser);
	await page.waitForFunction(() => window.app?.workspace?.layoutReady === true, null, { timeout: 30000 });
	await trustVaultIfAsked(page);
	return {
		browser,
		page,
		logs,
		async close() {
			await Promise.race([browser.close().catch(() => {}), new Promise((done) => setTimeout(done, 1500))]);
			child.kill("SIGTERM");
			await new Promise((done) => setTimeout(done, 1000));
			if (child.exitCode === null) child.kill("SIGKILL");
		},
	};
}

async function connectWithRetry() {
	const deadline = Date.now() + 30000;
	let lastError;
	while (Date.now() < deadline) {
		try {
			return await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
		} catch (error) {
			lastError = error;
			await new Promise((done) => setTimeout(done, 300));
		}
	}
	throw lastError;
}

async function findVaultPage(browser) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				const hasApp = await page.evaluate(() => typeof window.app !== "undefined" && !!window.app.vault).catch(() => false);
				if (hasApp) return page;
			}
		}
		await new Promise((done) => setTimeout(done, 300));
	}
	throw new Error("No Obsidian vault window found");
}

async function trustVaultIfAsked(page) {
	const trustButton = page.getByRole("button", { name: "Trust author and enable plugins" });
	if (await trustButton.isVisible({ timeout: 3000 }).catch(() => false)) {
		await trustButton.click();
		await page.waitForTimeout(500);
	}
	await page.waitForFunction(() => !!window.app.plugins.plugins.vikalp, null, { timeout: 15000 }).catch(() => {});
}
