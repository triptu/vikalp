import type { ClassifierModel, Model } from "@earendil-works/pi-ai";

export class AiError extends Error {
	constructor(
		message: string,
		/** True when the server couldn't be reached at all, as opposed to answering with an error. */
		readonly unreachable = false,
	) {
		super(message);
	}
}

/** Whether a call's cost is known: from the price list, free on this computer, or unknown. */
export type Pricing = "priced" | "free" | "unpriced";

export interface ResolvedModel {
	model: Model<never>;
	pricing: Pricing;
}

/** Where model calls go and how they are authorised, for the provider picked in settings. */
export interface AiBackend {
	/** Start of the sentence shown wherever AI can't run yet, e.g. "Add an OpenRouter API key in Vikalp settings". Null once it can. */
	setupHint: string | null;
	/** The key sent with each request. Servers without keys get a placeholder. */
	apiKey: string;
	chatModel(id: string): ResolvedModel;
	/** Looks up a Jev classifier. Absent when the provider has no Jev; judgments then use the chat model. */
	jevModel?(id: string): ClassifierModel<never> | undefined;
	/** Model ids the writer can pick from. */
	listModels(signal?: AbortSignal): Promise<string[]>;
	/** Turns a raw provider error into a sentence for the writer. */
	friendlyError(raw: string, modelId?: string): string;
}
