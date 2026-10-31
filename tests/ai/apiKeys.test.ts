import { Type } from "typebox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiClient } from "../../src/ai/aiClient";
import { loadSettings, mergeSettings, stashApiKeys, type ApiKeyStore } from "../../src/core/settings";
import { fetchJson } from "../support/fetchJson";
import { startMockModelServer, type MockModelServer } from "../support/mockModelServer";

/** Stands in for Obsidian's secret storage. */
function secretStorage(options: { refuses?: boolean } = {}) {
	const secrets = new Map<string, string>();
	const store: ApiKeyStore = {
		read: (provider) => secrets.get(provider) ?? null,
		write: (provider, key) => {
			if (options.refuses) throw new Error("secret storage is locked");
			secrets.set(provider, key);
		},
	};
	return { store, secrets };
}

const alternativesRequest = {
	purpose: "alternatives",
	mode: "lite" as const,
	system: "Give alternatives.",
	user: "tension",
	toolName: "give_alternatives",
	toolDescription: "Alternatives for a word",
	schema: Type.Object({ alternatives: Type.Array(Type.String()) }),
};

const openRouterModels = { lite: "x/lite", medium: "x/medium", heavy: "x/heavy" };
const oldDataJson = () => ({ provider: "openrouter" as const, providers: { openrouter: { apiKey: "sk-or-old", baseUrl: "", models: openRouterModels } } });

describe("where API keys live", () => {
	let server: MockModelServer;
	beforeAll(async () => {
		server = await startMockModelServer(["qwen3:0.6b"]);
	});
	afterAll(() => server.close());

	it("a key saved in settings is used for requests and isn't in data.json", async () => {
		const { store } = secretStorage();
		const settings = mergeSettings({ provider: "custom" });
		settings.providers.custom = { apiKey: "secret-1", baseUrl: server.baseUrl, models: { lite: "qwen3:0.6b", medium: "qwen3:0.6b", heavy: "qwen3:0.6b" } };

		const dataJson = stashApiKeys(settings, store);
		expect(JSON.stringify(dataJson)).not.toContain("secret-1");
		expect(dataJson.providers.custom?.baseUrl).toBe(server.baseUrl);

		await new AiClient(() => settings, () => {}, fetchJson).structured(alternativesRequest);
		expect(server.requests.at(-1)?.authorization).toBe("Bearer secret-1");

		const nextSession = loadSettings(JSON.parse(JSON.stringify(dataJson)), store);
		expect(nextSession.settings.providers.custom.apiKey).toBe("secret-1");
		expect(nextSession.moved).toBeNull();
	});

	it("an old plaintext key is moved on load", () => {
		const { store, secrets } = secretStorage();
		const { settings, moved } = loadSettings(oldDataJson(), store);
		expect(settings.providers.openrouter.apiKey).toBe("sk-or-old");
		expect(secrets.get("openrouter")).toBe("sk-or-old");
		expect(moved).not.toBeNull();
		expect(JSON.stringify(moved)).not.toContain("sk-or-old");
		expect(moved?.providers.openrouter?.models).toEqual(openRouterModels);
	});

	it("a key from before providers existed is moved too", () => {
		const { store, secrets } = secretStorage();
		const { settings, moved } = loadSettings({ openRouterApiKey: "sk-or-older" } as never, store);
		expect(settings.providers.openrouter.apiKey).toBe("sk-or-older");
		expect(secrets.get("openrouter")).toBe("sk-or-older");
		expect(JSON.stringify(moved)).not.toContain("sk-or-older");
	});

	it("a key stays in data.json until secret storage has taken it", () => {
		const { store, secrets } = secretStorage({ refuses: true });
		const { settings, moved } = loadSettings(oldDataJson(), store);
		expect(settings.providers.openrouter.apiKey).toBe("sk-or-old");
		expect(secrets.size).toBe(0);
		expect(moved?.providers.openrouter?.apiKey).toBe("sk-or-old");
	});

	it("without secret storage, keys stay in data.json as before", () => {
		const { settings, moved } = loadSettings(oldDataJson(), null);
		expect(settings.providers.openrouter.apiKey).toBe("sk-or-old");
		expect(moved).toBeNull();
		expect(stashApiKeys(settings, null).providers.openrouter?.apiKey).toBe("sk-or-old");
	});

	it("removing a key removes it from secret storage as well", () => {
		const { store, secrets } = secretStorage();
		const { settings } = loadSettings(oldDataJson(), store);
		settings.providers.openrouter.apiKey = "";
		const dataJson = stashApiKeys(settings, store);
		expect(dataJson.providers.openrouter?.apiKey).toBeUndefined();
		expect(secrets.get("openrouter")).toBe("");
		expect(loadSettings(dataJson, store).settings.providers.openrouter.apiKey).toBe("");
	});
});
