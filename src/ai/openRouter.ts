import type { ClassifierModel, Model } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { VikalpSettings } from "../core/settings";
import { AiError, type AiBackend } from "./backend";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Sends every call to OpenRouter with the writer's own API key. */
export function openRouterBackend(models: MutableModels): AiBackend {
	models.setProvider(openrouterProvider());
	const key = (settings: VikalpSettings) => settings.openRouterApiKey.trim();

	return {
		setupHint: "Add an OpenRouter API key in Vikalp settings",

		isReady: (settings) => key(settings).length > 0,

		requestOptions(settings) {
			if (!key(settings)) throw new AiError("Add an OpenRouter API key in Vikalp settings first.");
			return { apiKey: key(settings) };
		},

		chatModel(id) {
			const known = models.getModel("openrouter", id);
			// pi-ai sends Anthropic models through the Anthropic SDK, which can't connect from Obsidian's
			// renderer. OpenRouter's OpenAI-style endpoint serves every model, so all calls use it.
			if (known && known.api !== "openai-completions") return { ...known, api: "openai-completions", baseUrl: OPENROUTER_BASE_URL } as unknown as Model<never>;
			if (known) return known as Model<never>;
			const template = models.getModel("openrouter", "openai/gpt-6-luna");
			if (!template) throw new AiError(`Unknown model "${id}".`);
			return { ...template, id, name: id, api: "openai-completions", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as unknown as Model<never>;
		},

		jevModel: (id) => models.getModelOfType("classifier", "openrouter", id) as ClassifierModel<never> | undefined,

		friendlyError(raw) {
			if (/401|unauthor|invalid api key|no auth/i.test(raw)) return "OpenRouter rejected the API key. Check it in Vikalp settings.";
			if (/402|credit|insufficient/i.test(raw)) return "OpenRouter says the account is out of credits.";
			if (/429|rate/i.test(raw)) return "OpenRouter is rate limiting. Wait a moment and try again.";
			if (/abort/i.test(raw)) return "Cancelled.";
			return `The model call failed: ${raw}`;
		},
	};
}
