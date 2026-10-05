import type { Model } from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { AiError, type AiBackend } from "./backend";

/** pi-ai's provider id for OpenAI, which owns the ChatGPT sign-in. */
export const CHATGPT_PROVIDER_ID = "openai";

// pi-ai loads its sign-in flows through a dynamic import that a single-file bundle can't follow.
// Registering them up front puts them in main.js.
registerBunOAuthFlows();

/** Sends calls to OpenAI with the writer's ChatGPT sign-in. Usage counts against their ChatGPT plan. */
export function chatgptBackend(models: MutableModels): AiBackend {
	models.setProvider(openaiProvider());

	return {
		setupHint: "Sign in with ChatGPT in Vikalp settings",
		includedInPlan: true,

		isReady: (settings) => settings.chatgptToken !== null,

		modelId: (settings, mode) => settings.chatgptModels[mode],

		requestOptions(settings) {
			if (!settings.chatgptToken) throw new AiError("Sign in with ChatGPT in Vikalp settings first.");
			// pi-ai reads the token from the credential store and refreshes it when needed.
			return {};
		},

		chatModel(id) {
			const known = models.getModel(CHATGPT_PROVIDER_ID, id);
			if (known) return known as Model<never>;
			const template = models.getModel(CHATGPT_PROVIDER_ID, "gpt-6-luna");
			if (!template) throw new AiError(`Unknown model "${id}".`);
			return { ...template, id, name: id } as unknown as Model<never>;
		},

		friendlyError(raw) {
			if (/401|unauthor|not configured|refresh/i.test(raw)) return "ChatGPT sign-in has expired. Sign in again in Vikalp settings.";
			if (/429|rate|quota|limit/i.test(raw)) return "You've hit your ChatGPT plan's limit. Wait a while and try again.";
			if (/404|model.*(not found|does not exist)/i.test(raw)) return "Your ChatGPT plan can't use this model. Pick another in Vikalp settings.";
			if (/abort/i.test(raw)) return "Cancelled.";
			return `The model call failed: ${raw}`;
		},
	};
}
