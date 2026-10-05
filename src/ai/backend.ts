import type { ClassifierModel, Model } from "@earendil-works/pi-ai";
import type { VikalpSettings } from "../core/settings";

export class AiError extends Error {}

/** Where model calls go and how they are authorised. `AiClient` uses one backend at a time. */
export interface AiBackend {
	/** Start of the sentence shown wherever AI can't run yet, e.g. "Add an OpenRouter API key in Vikalp settings". */
	setupHint: string;
	isReady(settings: VikalpSettings): boolean;
	/** Auth for one request. Throws `AiError` when the backend isn't set up. */
	requestOptions(settings: VikalpSettings): { apiKey?: string };
	chatModel(id: string): Model<never>;
	/** Looks up a Jev classifier. Absent when the backend has no Jev; judgments then use the chat model. */
	jevModel?(id: string): ClassifierModel<never> | undefined;
	/** Turns a raw provider error into a sentence for the writer. */
	friendlyError(raw: string): string;
}
