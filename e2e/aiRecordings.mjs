// Replays recorded AI answers so flows don't wait on the model. A request with no recording
// goes to the real model once and its answer is saved to e2e/ai-recordings.json for next time.
import { resolve } from "node:path";

export const RECORDINGS_PATH = resolve(new URL(".", import.meta.url).pathname, "ai-recordings.json");

// Replayed answers still arrive a little late, so flows that edit while AI runs keep testing that race.
const REPLAY_DELAY_MS = 150;

/**
 * Wraps the plugin's AI client in the page. With `live`, every request goes to the
 * model and its answer replaces the recording. Failed requests are never recorded.
 */
export async function useAiRecordings(page, { live = false } = {}) {
	await page.evaluate(
		({ path, live, delayMs }) => {
			const fs = window.require("fs");
			const { createHash } = window.require("crypto");
			const ai = window.app.plugins.plugins.vikalp.ai;
			const recordings = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
			const stats = (window.vikalpAiStats = { replayed: 0, recorded: 0 });
			const save = () => {
				const sorted = Object.fromEntries(Object.entries(recordings).sort(([a], [b]) => a.localeCompare(b)));
				fs.writeFileSync(path, `${JSON.stringify(sorted, null, "\t")}\n`);
			};
			const record = (method, describe, replay) => {
				const original = ai[method].bind(ai);
				ai[method] = async (...args) => {
					const { purpose, request } = describe(...args);
					const key = createHash("sha256").update(JSON.stringify([method, request])).digest("hex").slice(0, 16);
					if (!live && recordings[key]) {
						stats.replayed++;
						await new Promise((done) => setTimeout(done, delayMs));
						return replay(recordings[key].result, ...args);
					}
					const result = await original(...args);
					recordings[key] = { purpose, result };
					stats.recorded++;
					save();
					return result;
				};
			};
			record(
				"structured",
				(request) => ({ purpose: request.purpose, request: [request.purpose, request.mode, request.system, request.user] }),
				(result, request) => {
					request.onPartial?.(result.value);
					return result;
				},
			);
			record(
				"classify",
				(purpose, state, questions) => ({ purpose, request: [purpose, state, questions] }),
				(result) => result,
			);
		},
		{ path: RECORDINGS_PATH, live, delayMs: REPLAY_DELAY_MS },
	);
}

export async function aiStats(page) {
	return page.evaluate(() => window.vikalpAiStats ?? { replayed: 0, recorded: 0 }).catch(() => ({ replayed: 0, recorded: 0 }));
}
