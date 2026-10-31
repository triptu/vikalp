/** A JSON reply with its status, or null when the body wasn't JSON. Rejects only when the server couldn't be reached. */
export interface JsonAnswer {
	status: number;
	body: unknown;
}

/** A GET for JSON. The plugin sends it through Obsidian's `requestUrl`; tests use fetch. */
export type GetJson = (url: string, headers: Record<string, string>, signal?: AbortSignal) => Promise<JsonAnswer>;

export function isSuccess(status: number): boolean {
	return status >= 200 && status < 300;
}
