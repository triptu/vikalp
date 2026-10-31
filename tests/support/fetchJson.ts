import type { GetJson } from "../../src/ai/http";

/** Stands in for the plugin's requestUrl-based GET in Node. */
export const fetchJson: GetJson = async (url, headers, signal) => {
	const response = await fetch(url, { headers, signal });
	return { status: response.status, body: await response.json().catch(() => null) };
};
