import type { DataAdapter } from "obsidian";
import { fetchOpenModelPicks } from "../ai/openModels";
import type { OpenModelPicks } from "../core/modelChoices";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface SavedPicks {
	fetchedAt: number;
	picks: OpenModelPicks;
}

/**
 * Open models suggested in OpenRouter's model lists. Saved in the plugin folder
 * and fetched again at most once a day, only while settings are open.
 */
export class OpenModelPicksCache {
	private saved: SavedPicks | null = null;
	private refreshing: Promise<boolean> | null = null;
	/** One fetch per session at most, so a failing network isn't retried on every redraw. */
	private fetched = false;

	constructor(
		private readonly adapter: Pick<DataAdapter, "exists" | "read" | "write">,
		private readonly path: string,
	) {}

	get picks(): OpenModelPicks | null {
		return this.saved?.picks ?? null;
	}

	/** Loads the saved picks, and fetches new ones if they are a day old. Resolves true when the picks changed. Failures keep the old picks. */
	refresh(apiKey: string): Promise<boolean> {
		this.refreshing ??= this.update(apiKey).finally(() => (this.refreshing = null));
		return this.refreshing;
	}

	private async update(apiKey: string): Promise<boolean> {
		const loaded = await this.load().catch(() => false);
		if (!apiKey || this.fetched || (this.saved && Date.now() - this.saved.fetchedAt < ONE_DAY_MS)) return loaded;
		this.fetched = true;
		try {
			this.saved = { fetchedAt: Date.now(), picks: await fetchOpenModelPicks(apiKey) };
			await this.adapter.write(this.path, JSON.stringify(this.saved, null, "\t"));
			return true;
		} catch {
			return loaded;
		}
	}

	/** Reads the saved picks once. True when it found some. */
	private async load(): Promise<boolean> {
		if (this.saved || !(await this.adapter.exists(this.path))) return false;
		this.saved = JSON.parse(await this.adapter.read(this.path)) as SavedPicks;
		return true;
	}
}
