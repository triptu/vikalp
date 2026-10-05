import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

/**
 * Keeps pi-ai's sign-in credentials in a slot Vikalp owns (the plugin's
 * settings), one per provider. Writes are queued so a token refresh and a
 * sign-in can never overwrite each other.
 */
export class SlotCredentialStore implements CredentialStore {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly slots: Record<string, StoredSlot>,
	) {}

	async read(providerId: string): Promise<Credential | undefined> {
		return this.slots[providerId]?.get();
	}

	async list(): Promise<readonly CredentialInfo[]> {
		return Object.entries(this.slots).flatMap(([providerId, slot]) => {
			const credential = slot.get();
			return credential ? [{ providerId, type: credential.type }] : [];
		});
	}

	modify(providerId: string, change: (current: Credential | undefined) => Promise<Credential | undefined>, _options?: AuthOperationOptions): Promise<Credential | undefined> {
		return this.enqueue(async () => {
			const slot = this.slotFor(providerId);
			const next = await change(slot.get());
			if (next === undefined) return slot.get();
			await slot.set(next);
			return next;
		});
	}

	async delete(providerId: string): Promise<void> {
		await this.enqueue(async () => this.slotFor(providerId).set(undefined));
	}

	private slotFor(providerId: string): StoredSlot {
		const slot = this.slots[providerId];
		if (!slot) throw new Error(`No place to keep a sign-in for "${providerId}".`);
		return slot;
	}

	private enqueue<Result>(task: () => Promise<Result>): Promise<Result> {
		const run = this.queue.then(task, task);
		this.queue = run.catch(() => undefined);
		return run;
	}
}

export interface StoredSlot {
	get(): Credential | undefined;
	set(credential: Credential | undefined): Promise<void>;
}
