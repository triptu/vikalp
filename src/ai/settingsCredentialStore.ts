import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import type { OAuthToken, VikalpSettings } from "../core/settings";

/**
 * Keeps the ChatGPT sign-in token in plugin settings, so it survives restarts.
 * pi-ai writes through `modify` when it signs in or refreshes the token.
 * Only `providerId` is stored; other providers authenticate with explicit keys.
 */
export class SettingsCredentialStore implements CredentialStore {
	private writes: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly providerId: string,
		private readonly getSettings: () => VikalpSettings,
		private readonly saveSettings: () => Promise<void>,
	) {}

	async read(providerId: string): Promise<Credential | undefined> {
		return providerId === this.providerId ? (this.getSettings().chatgptToken ?? undefined) : undefined;
	}

	async list(): Promise<readonly CredentialInfo[]> {
		return this.getSettings().chatgptToken ? [{ providerId: this.providerId, type: "oauth" }] : [];
	}

	modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
		return this.serialize(async () => {
			const current = await this.read(providerId);
			const next = await fn(current);
			if (next === undefined) return current;
			if (providerId !== this.providerId || next.type !== "oauth") throw new Error(`Vikalp only stores the ChatGPT sign-in, not ${providerId} ${next.type}.`);
			await this.write(next);
			return next;
		});
	}

	delete(providerId: string): Promise<void> {
		return this.serialize(async () => {
			if (providerId === this.providerId) await this.write(null);
		});
	}

	private async write(token: OAuthToken | null) {
		this.getSettings().chatgptToken = token;
		await this.saveSettings();
	}

	/** One write at a time, so a token refresh and a sign-out can't interleave. */
	private serialize<Result>(task: () => Promise<Result>): Promise<Result> {
		const run = this.writes.then(task, task);
		this.writes = run.catch(() => undefined);
		return run;
	}
}
