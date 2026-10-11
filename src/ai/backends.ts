import type { ClassifierModel, Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createProvider, type MutableModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { protocolFor, runsLocally, shortServerName, type ProviderPreset } from "../core/providers";
import { activeProvider, type ActiveProvider, type VikalpSettings } from "../core/settings";
import { AiError, type AiBackend, type Pricing } from "./backend";

/** pi-ai provider id for servers Vikalp only knows by URL. */
const SERVER_PROVIDER = "vikalp-server";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Registers every provider Vikalp can send to. Call once per `Models`. */
export function registerProviders(models: MutableModels) {
	models.setProvider(openrouterProvider());
	models.setProvider(anthropicProvider());
	models.setProvider(openaiProvider());
	models.setProvider(
		createProvider({
			id: SERVER_PROVIDER,
			// Every request passes its key explicitly, so there is nothing to look up.
			auth: { apiKey: { name: "Server API key", resolve: async ({ credential }) => (credential?.key ? { auth: { apiKey: credential.key } } : undefined) } },
			models: [],
			api: openAICompletionsApi(),
		}),
	);
}

/** The backend for the provider picked in settings. The server URL decides the protocol. */
export function backendFor(models: MutableModels, settings: VikalpSettings): AiBackend {
	const active = activeProvider(settings);
	switch (protocolFor(active.baseUrl)) {
		case "openrouter":
			return openRouterBackend(models, active);
		case "anthropic":
			return catalogBackend(models, active, "anthropic");
		case "openai":
			return catalogBackend(models, active, "openai");
		case "openai-compatible":
			return serverBackend(active);
	}
}

/** OpenRouter: the catalog's prices, and Jev for yes/no judgments. */
function openRouterBackend(models: MutableModels, active: ActiveProvider): AiBackend {
	return {
		...commonParts(active),
		chatModel(id) {
			const known = models.getModel("openrouter", id);
			// pi-ai sends Anthropic models through the Anthropic SDK, and OpenRouter's CORS rules block its headers
			// from Obsidian's renderer. OpenRouter's OpenAI-style endpoint serves every model, so all calls use it.
			if (known) return { model: { ...known, api: "openai-completions", baseUrl: active.baseUrl } as unknown as Model<never>, pricing: pricingOf(known) };
			const template = models.getModel("openrouter", "openai/gpt-6-luna");
			if (!template) throw new AiError(`Unknown model "${id}".`);
			return { model: { ...template, id, name: id, api: "openai-completions", baseUrl: active.baseUrl, cost: ZERO_COST } as unknown as Model<never>, pricing: "unpriced" };
		},
		jevModel: (id) => models.getModelOfType("classifier", "openrouter", id) as ClassifierModel<never> | undefined,
		listModels: async () => models.getModels("openrouter").map((model) => model.id),
	};
}

/** Anthropic or OpenAI directly, using pi-ai's own client and price list for each. */
function catalogBackend(models: MutableModels, active: ActiveProvider, provider: "anthropic" | "openai"): AiBackend {
	return {
		...commonParts(active),
		chatModel(id) {
			const known = models.getModel(provider, id);
			if (known) return { model: { ...known, baseUrl: active.baseUrl } as unknown as Model<never>, pricing: pricingOf(known) };
			const template = models.getModel(provider, active.preset.modes?.lite ?? "");
			if (!template) throw new AiError(`Unknown model "${id}".`);
			return { model: { ...template, id, name: id, baseUrl: active.baseUrl, cost: ZERO_COST } as unknown as Model<never>, pricing: "unpriced" };
		},
		listModels: async () => models.getModels(provider).map((model) => model.id),
	};
}

/** Any OpenAI-compatible server: Ollama, LM Studio, or a URL the writer typed. */
function serverBackend(active: ActiveProvider): AiBackend {
	const pricing: Pricing = runsLocally(active.preset.id, active.baseUrl) ? "free" : "unpriced";
	return {
		...commonParts(active),
		// The OpenAI client refuses to send without a key, and local servers ignore it.
		apiKey: active.apiKey || "none",
		chatModel(id) {
			const model = {
				id,
				name: id,
				api: "openai-completions",
				provider: SERVER_PROVIDER,
				baseUrl: active.baseUrl,
				input: ["text"],
				cost: ZERO_COST,
				reasoning: false,
				contextWindow: 32768,
				maxTokens: 8000,
			};
			return { model: model as unknown as Model<never>, pricing };
		},
		listModels: async (signal) => {
			let response: Response;
			try {
				response = await fetch(`${active.baseUrl.replace(/\/+$/, "")}/models`, { headers: active.apiKey ? { Authorization: `Bearer ${active.apiKey}` } : {}, signal });
			} catch (error) {
				if (signal?.aborted) throw new AiError("Cancelled.");
				throw new AiError(unreachable(active.preset, active.baseUrl), true);
			}
			if (response.status === 401 || response.status === 403) throw new AiError(`${displayName(active.preset)} rejected the API key.`);
			if (response.status === 404) throw new AiError("No model list at this URL. OpenAI-compatible URLs usually end in /v1.");
			if (!response.ok) throw new AiError(`The server answered with error ${response.status}.`);
			const listing = (await response.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null;
			if (!Array.isArray(listing?.data)) throw new AiError("The server's answer wasn't a model list. OpenAI-compatible URLs usually end in /v1.");
			return listing.data.flatMap((entry) => (typeof entry.id === "string" ? [entry.id] : []));
		},
	};
}

function commonParts(active: ActiveProvider): Pick<AiBackend, "setupHint" | "apiKey" | "friendlyError"> {
	return {
		setupHint: setupHint(active),
		apiKey: active.apiKey,
		friendlyError: (raw, modelId) => friendlyError(active, raw, modelId),
	};
}

function setupHint({ preset, baseUrl, apiKey, models }: ActiveProvider): string | null {
	if (!baseUrl) return "Add a server URL in Vikalp settings";
	if (preset.key === "required" && !apiKey) return `Add an ${preset.label} API key in Vikalp settings`;
	if (!models.lite.trim()) return "Pick a model in Vikalp settings";
	return null;
}

function friendlyError({ preset, baseUrl }: ActiveProvider, raw: string, modelId?: string): string {
	const name = displayName(preset);
	if (/abort/i.test(raw)) return "Cancelled.";
	if (/connection error|failed to fetch|fetch failed|econnrefused|network error/i.test(raw)) return unreachable(preset, baseUrl);
	if (/\b40[13]\b|unauthori[sz]ed|invalid.*api key|no auth/i.test(raw)) return `${name} rejected the API key. Check it in Vikalp settings.`;
	if (/\b402\b|credit|insufficient/i.test(raw)) return `${name} says the account is out of credits.`;
	if (/\b404\b/.test(raw) && /model/i.test(raw)) return `${name} doesn't have the model${modelId ? ` "${modelId}"` : ""}. Pick another in Vikalp settings.`;
	if (/\b429\b|rate limit/i.test(raw)) return `${name} is rate limiting. Wait a moment and try again.`;
	return `The model call failed: ${shorten(raw)}`;
}

/** Keeps an unexpected server answer readable: no markup, one line, not too long. */
function shorten(raw: string): string {
	const plain = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
	return plain.length > 140 ? `${plain.slice(0, 140)}…` : plain;
}

function displayName(preset: ProviderPreset): string {
	return preset.modes ? preset.label : capitalise(preset.serverName);
}

function unreachable(preset: ProviderPreset, baseUrl: string): string {
	const where = shortServerName(baseUrl);
	if (preset.id === "ollama") return `Can't reach ${where}. Is Ollama running?`;
	if (preset.id === "lmstudio") return `Can't reach ${where}. Is LM Studio's server running, with CORS turned on?`;
	if (preset.id === "custom") return `Can't reach ${where}. Check the URL, and that the server accepts requests from Obsidian.`;
	return `Can't reach ${preset.label}. Check your connection and try again.`;
}

function pricingOf(model: { cost: { input: number; output: number } }): Pricing {
	return model.cost.input > 0 || model.cost.output > 0 ? "priced" : "unpriced";
}

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
