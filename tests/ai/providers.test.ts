import { Type } from "typebox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiClient, AiError, type CostRecord } from "../../src/ai/aiClient";
import { protocolFor } from "../../src/core/providers";
import { mergeSettings, type VikalpSettings } from "../../src/core/settings";
import { initialUiState, sessionCostSummary, type CostEntry, type VikalpUiState } from "../../src/store/uiStore";
import { formatSessionCost } from "../../src/views/format";
import { startMockModelServer, type MockModelServer } from "../support/mockModelServer";

function clientFor(settings: VikalpSettings) {
	const costs: CostRecord[] = [];
	return { client: new AiClient(() => settings, (record) => costs.push(record)), costs };
}

function localSettings(baseUrl: string, model: string): VikalpSettings {
	const settings = mergeSettings({ provider: "ollama" });
	settings.providers.ollama.baseUrl = baseUrl;
	settings.providers.ollama.models = { lite: model, medium: model, heavy: model };
	return settings;
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

describe("settings from before providers existed", () => {
	it("keep the OpenRouter key and models, and stay on OpenRouter", () => {
		const settings = mergeSettings({ openRouterApiKey: "sk-or-old", models: { lite: "x/lite", medium: "x/medium", heavy: "x/heavy" } } as never);
		expect(settings.provider).toBe("openrouter");
		expect(settings.providers.openrouter.apiKey).toBe("sk-or-old");
		expect(settings.providers.openrouter.models).toEqual({ lite: "x/lite", medium: "x/medium", heavy: "x/heavy" });
		expect("openRouterApiKey" in settings).toBe(false);
	});

	it("a new install starts on OpenRouter with its default models", () => {
		const settings = mergeSettings(null);
		expect(settings.provider).toBe("openrouter");
		expect(settings.providers.anthropic.models.heavy).toBe("claude-opus-5-5");
		expect(settings.providers.openai.models.heavy).toBe("gpt-5.6-sol");
	});
});

describe("switching providers", () => {
	it("keeps each provider's key, so switching back needs nothing re-entered", () => {
		const settings = mergeSettings(null);
		settings.providers.openrouter.apiKey = "sk-or-1";
		settings.provider = "anthropic";
		settings.providers.anthropic.apiKey = "sk-ant-1";
		const reloaded = mergeSettings(JSON.parse(JSON.stringify(settings)));
		reloaded.provider = "openrouter";
		expect(reloaded.providers.openrouter.apiKey).toBe("sk-or-1");
		expect(reloaded.providers.anthropic.apiKey).toBe("sk-ant-1");
	});

	it("the server URL decides how Vikalp talks to it", () => {
		expect(protocolFor("https://api.anthropic.com")).toBe("anthropic");
		expect(protocolFor("https://api.openai.com/v1")).toBe("openai");
		expect(protocolFor("https://openrouter.ai/api/v1")).toBe("openrouter");
		expect(protocolFor("https://api.groq.com/openai/v1")).toBe("openai-compatible");
		expect(protocolFor("http://localhost:11434/v1")).toBe("openai-compatible");
	});
});

describe("telling the writer what's missing", () => {
	it("asks for the key the chosen provider needs", () => {
		const { client } = clientFor(mergeSettings({ provider: "anthropic" }));
		expect(client.isReady).toBe(false);
		expect(client.setupHint).toBe("Add an Anthropic API key in Vikalp settings");
	});

	it("asks for a model on a local server, and needs no key", () => {
		const { client } = clientFor(mergeSettings({ provider: "ollama" }));
		expect(client.setupHint).toBe("Pick a model in Vikalp settings");
		const ready = clientFor(localSettings("http://localhost:11434/v1", "qwen3:8b")).client;
		expect(ready.isReady).toBe(true);
	});

	it("asks for a URL on a custom server", () => {
		const { client } = clientFor(mergeSettings({ provider: "custom" }));
		expect(client.setupHint).toBe("Add a server URL in Vikalp settings");
	});

	it("only OpenRouter offers Jev for yes/no judgments", () => {
		const openRouter = mergeSettings(null);
		openRouter.providers.openrouter.apiKey = "sk-or-1";
		expect(clientFor(openRouter).client.hasJev).toBe(true);
		expect(clientFor(mergeSettings({ provider: "anthropic" })).client.hasJev).toBe(false);
		expect(clientFor(localSettings("http://localhost:11434/v1", "qwen3:8b")).client.hasJev).toBe(false);
	});
});

describe("a model running on this computer", () => {
	let server: MockModelServer;
	beforeAll(async () => {
		server = await startMockModelServer(["qwen3:0.6b", "gemma3:1b"]);
	});
	afterAll(() => server.close());

	it("lists the models the server has", async () => {
		const { client } = clientFor(localSettings(server.baseUrl, ""));
		expect((await client.listModels()).map((model) => model.id)).toEqual(["qwen3:0.6b", "gemma3:1b"]);
	});

	it("answers a request with the model the writer picked, and costs nothing", async () => {
		server.toolArguments = { alternatives: ["pressure", "strain"] };
		const { client, costs } = clientFor(localSettings(server.baseUrl, "gemma3:1b"));
		const answer = await client.structured<{ alternatives: string[] }>(alternativesRequest);
		expect(answer.value.alternatives).toEqual(["pressure", "strain"]);
		expect(server.requests.at(-1)?.model).toBe("gemma3:1b");
		expect(costs.at(-1)).toMatchObject({ model: "gemma3:1b", cost: 0, pricing: "free", inputTokens: 120, outputTokens: 30 });
	});

	it("says plainly when the model isn't on the server", async () => {
		const { client } = clientFor(localSettings(server.baseUrl, "llama9:70b"));
		await expect(client.structured(alternativesRequest)).rejects.toThrow(`Ollama doesn't have the model "llama9:70b". Pick another in Vikalp settings.`);
	});

	it("says plainly when the server isn't running", async () => {
		const { client } = clientFor(localSettings("http://localhost:9/v1", "qwen3:0.6b"));
		await expect(client.structured(alternativesRequest)).rejects.toThrow("Can't reach localhost:9. Is Ollama running?");
		await expect(client.listModels()).rejects.toThrow("Can't reach localhost:9. Is Ollama running?");
		expect(await client.listModels().catch((error: AiError) => error.unreachable)).toBe(true);
	});

	it("says how to fix a URL that has no model list", async () => {
		const { client } = clientFor(localSettings(server.baseUrl.replace(/\/v1$/, ""), ""));
		await expect(client.listModels()).rejects.toThrow("No model list at this URL. OpenAI-compatible URLs usually end in /v1.");
	});

	it("works when the URL is typed without http://", async () => {
		const { client } = clientFor(localSettings(server.baseUrl.replace("http://", ""), "gemma3:1b"));
		expect((await client.listModels()).map((model) => model.id)).toEqual(["qwen3:0.6b", "gemma3:1b"]);
	});

	it("a crashed model isn't reported as the writer cancelling", async () => {
		server.failWith = "llama runner process has terminated: signal: aborted";
		try {
			const { client } = clientFor(localSettings(server.baseUrl, "gemma3:1b"));
			const failure = await client.structured(alternativesRequest).catch((error: Error) => error.message);
			expect(failure).not.toBe("Cancelled.");
			expect(failure).toContain("signal: aborted");
		} finally {
			server.failWith = null;
		}
	});

	it("sends the key to a custom server that asks for one", async () => {
		const settings = mergeSettings({ provider: "custom" });
		settings.providers.custom = { apiKey: "secret-1", baseUrl: server.baseUrl, models: { lite: "qwen3:0.6b", medium: "qwen3:0.6b", heavy: "qwen3:0.6b" } };
		await clientFor(settings).client.structured(alternativesRequest);
		expect(server.requests.at(-1)?.authorization).toBe("Bearer secret-1");
	});
});

describe("what the Lab shows for cost", () => {
	const entry = (pricing: CostEntry["pricing"], cost: number): CostEntry => ({ id: "c", at: 0, purpose: "p", model: "m", inputTokens: 1000, outputTokens: 200, cost, pricing });
	const shown = (state: VikalpUiState) => formatSessionCost(sessionCostSummary(state));
	const local = { ...initialUiState, aiModel: { providerLabel: "Ollama", hasModes: false, modelId: "qwen3:0.6b", free: true } };

	it("a price when every call has one", () => {
		expect(shown({ ...initialUiState, costs: [entry("priced", 0.02)] })).toBe("$0.02");
	});

	it("Free on a local model", () => {
		expect(shown(local)).toBe("Free");
		expect(shown({ ...local, costs: [entry("free", 0)] })).toBe("Free");
	});

	it("tokens when a server's prices are unknown, and keeps earlier spend in view", () => {
		expect(shown({ ...initialUiState, costs: [entry("unpriced", 0), entry("unpriced", 0)] })).toBe("2.4k tokens");
		expect(shown({ ...initialUiState, costs: [entry("priced", 0.12), entry("unpriced", 0)] })).toBe("$0.12 + 1.2k tokens");
	});
});
