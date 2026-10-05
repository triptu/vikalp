import { describe, expect, it } from "vitest";
import { SettingsCredentialStore } from "../../src/ai/settingsCredentialStore";
import { mergeSettings } from "../../src/core/settings";

const token = (access: string) => ({ type: "oauth" as const, access, refresh: "refresh", expires: Date.now() + 3600000 });

function setup() {
	const settings = mergeSettings(null);
	let saves = 0;
	const store = new SettingsCredentialStore("openai", () => settings, async () => void saves++);
	return { settings, store, saves: () => saves };
}

describe("the ChatGPT sign-in token", () => {
	it("is saved in settings when signing in, and replaced when refreshed", async () => {
		const { settings, store, saves } = setup();
		await store.modify("openai", async () => token("first"));
		await store.modify("openai", async (current) => (current?.type === "oauth" ? { ...current, access: "refreshed" } : undefined));
		expect(settings.chatgptToken?.access).toBe("refreshed");
		expect(saves()).toBe(2);
	});

	it("is cleared when signing out", async () => {
		const { settings, store } = setup();
		await store.modify("openai", async () => token("first"));
		await store.delete("openai");
		expect(settings.chatgptToken).toBeNull();
		expect(await store.list()).toEqual([]);
	});

	it("stays as it was when a refresh finds nothing to change", async () => {
		const { settings, store, saves } = setup();
		await store.modify("openai", async () => token("first"));
		await store.modify("openai", async () => undefined);
		expect(settings.chatgptToken?.access).toBe("first");
		expect(saves()).toBe(1);
	});

	it("doesn't let a sign-out land in the middle of a refresh", async () => {
		const { settings, store } = setup();
		await store.modify("openai", async () => token("first"));
		const refresh = store.modify("openai", async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			return token("refreshed");
		});
		const signOut = store.delete("openai");
		await Promise.all([refresh, signOut]);
		expect(settings.chatgptToken).toBeNull();
	});
});
