import { requestUrl } from "obsidian";
import type { GetJson } from "../ai/http";

/** Vikalp's GET for JSON, through Obsidian's `requestUrl` so it isn't subject to the renderer's CORS rules. */
export const requestJson: GetJson = async (url, headers, signal) => {
	const answer = await abortable(requestUrl({ url, headers, throw: false }), signal);
	let body: unknown = null;
	try {
		body = JSON.parse(answer.text);
	} catch {
		// Not JSON: the caller decides what to tell the writer.
	}
	return { status: answer.status, body };
};

/** `requestUrl` can't be cancelled, so the writer's timeout or cancel wins the race instead. */
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return work;
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
		if (signal.aborted) return abort();
		signal.addEventListener("abort", abort, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}
