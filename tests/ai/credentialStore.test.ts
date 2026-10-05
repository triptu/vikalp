import type { Credential } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { SlotCredentialStore, type StoredSlot } from "../../src/ai/credentialStore";

function memorySlot(initial?: Credential): StoredSlot & { saves: number } {
	let held = initial;
	const slot = {
		saves: 0,
		get: () => held,
		set: async (credential: Credential | undefined) => {
			held = credential;
			slot.saves++;
		},
	};
	return slot;
}

const signIn = (access: string): Credential => ({ type: "oauth", access, refresh: "r", expires: 0 }) as Credential;

describe("keeping the ChatGPT sign-in", () => {
	it("remembers a new sign-in and hands it back", async () => {
		const slot = memorySlot();
		const store = new SlotCredentialStore({ openai: slot });
		await store.modify("openai", async () => signIn("first"));
		expect(await store.read("openai")).toMatchObject({ access: "first" });
		expect(await store.list()).toEqual([{ providerId: "openai", type: "oauth" }]);
	});

	it("leaves the sign-in alone when a refresh has nothing new", async () => {
		const slot = memorySlot(signIn("kept"));
		const store = new SlotCredentialStore({ openai: slot });
		await store.modify("openai", async () => undefined);
		expect(await store.read("openai")).toMatchObject({ access: "kept" });
		expect(slot.saves).toBe(0);
	});

	it("forgets the sign-in on sign out", async () => {
		const store = new SlotCredentialStore({ openai: memorySlot(signIn("gone")) });
		await store.delete("openai");
		expect(await store.read("openai")).toBeUndefined();
		expect(await store.list()).toEqual([]);
	});

	it("does not lose a refresh when two happen at once", async () => {
		const store = new SlotCredentialStore({ openai: memorySlot(signIn("0")) });
		const bump = async (current: Credential | undefined) => signIn(`${Number((current as { access: string }).access) + 1}`);
		await Promise.all([store.modify("openai", bump), store.modify("openai", bump)]);
		expect(await store.read("openai")).toMatchObject({ access: "2" });
	});
});
