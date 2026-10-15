import type { AssistantMessage, Context, Tool } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import type { TSchema } from "typebox";
import type { ModelChoice } from "../core/modelChoices";
import { modelFor, type ModelMode, type VikalpSettings } from "../core/settings";
import { AiError, type AiBackend, type Pricing } from "./backend";
import { backendFor, registerProviders } from "./backends";

export { AiError };
export type { Pricing };

export interface CostRecord {
	purpose: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cost: number;
	pricing: Pricing;
	fallback?: boolean;
	error?: string;
}

export interface StructuredRequest<Output> {
	purpose: string;
	mode: ModelMode;
	system: string;
	user: string;
	toolName: string;
	toolDescription: string;
	schema: TSchema;
	signal?: AbortSignal;
	/** Called with the partially parsed tool arguments as they stream in. */
	onPartial?: (partial: Partial<Output>) => void;
}

export interface ClassifyQuestion {
	type: "bool";
	instructions: string;
	criteria: { true: string; false: string };
}

export interface ClassifyResult {
	answers: Record<string, number>;
	model: string;
}

/**
 * Talks to the provider picked in settings through pi-ai. Every call records its
 * cost. Auth comes from settings on each call, since the renderer has no environment.
 */
export class AiClient {
	private readonly models = createModels();

	constructor(
		private readonly getSettings: () => VikalpSettings,
		private readonly recordCost: (record: CostRecord) => void,
	) {
		registerProviders(this.models);
	}

	private get backend(): AiBackend {
		return backendFor(this.models, this.getSettings());
	}

	get isReady(): boolean {
		return this.backend.setupHint === null;
	}

	/** Start of the sentence that tells the writer how to set AI up, e.g. "Add an OpenRouter API key in Vikalp settings". */
	get setupHint(): string {
		return this.backend.setupHint ?? "";
	}

	/** Whether yes/no judgments can go to Jev. Without it they go to the chat model. */
	get hasJev(): boolean {
		return this.backend.jevModel !== undefined;
	}

	modelId(mode: ModelMode): string {
		return modelFor(this.getSettings(), mode);
	}

	/** Models the current provider offers. Throws `AiError` with a sentence for the writer when the server can't be reached. */
	listModels(signal?: AbortSignal): Promise<ModelChoice[]> {
		return this.backend.listModels(signal);
	}

	/** Asks a chat model for output shaped by `schema`, via a single tool call. */
	async structured<Output>(request: StructuredRequest<Output>): Promise<{ value: Output; model: string }> {
		const backend = this.backend;
		if (backend.setupHint) throw new AiError(`${backend.setupHint} first.`);
		const modelId = this.modelId(request.mode);
		const { model, pricing } = backend.chatModel(modelId);
		const tool: Tool = {
			name: request.toolName,
			description: request.toolDescription,
			parameters: request.schema,
			constrainedSampling: { type: "json_schema", strict: "prefer" },
		};
		const context: Context = {
			systemPrompt: `${request.system}\n\nAlways answer by calling the ${request.toolName} tool exactly once.`,
			messages: [{ role: "user", content: request.user, timestamp: Date.now() }],
			tools: [tool],
		};
		const stream = this.models.streamSimple(model, context, { apiKey: backend.apiKey, signal: request.signal, reasoning: "low", maxTokens: 8000 });
		let streamError: string | null = null;
		for await (const event of stream) {
			if (event.type === "toolcall_delta" && request.onPartial) {
				const block = event.partial.content[event.contentIndex];
				if (block?.type === "toolCall") request.onPartial(block.arguments as Partial<Output>);
			} else if (event.type === "error") {
				streamError = event.error.errorMessage ?? "The model returned an error.";
			}
		}
		const message = await stream.result();
		this.record(request.purpose, model.id, pricing, message, streamError ?? undefined);
		if (streamError) throw new AiError(backend.friendlyError(streamError, modelId));
		return { value: extractToolArguments<Output>(message, request.toolName), model: model.id };
	}

	/** Yes/no judgments from Jev, TypeSafe's decision model. Returns a probability per question. */
	async classify(purpose: string, state: Record<string, unknown>, questions: Record<string, ClassifyQuestion>, signal?: AbortSignal): Promise<ClassifyResult> {
		const backend = this.backend;
		if (backend.setupHint) throw new AiError(`${backend.setupHint} first.`);
		const modelId = this.getSettings().jevModel;
		const model = backend.jevModel?.(modelId);
		if (!model) throw new AiError(`Jev model "${modelId}" is not available.`);
		const result = await this.models.classify(model, { state: state as never, questions }, { apiKey: backend.apiKey, signal });
		const usage = result.usage;
		const failed = result.stopReason === "error";
		this.recordCost({
			purpose,
			model: modelId,
			inputTokens: usage?.input ?? 0,
			outputTokens: usage?.output ?? 0,
			cost: usage?.cost.total ?? 0,
			pricing: "priced",
			...(failed ? { error: result.errorMessage ?? "failed" } : {}),
		});
		if (failed) throw new AiError(result.errorMessage ?? "Jev could not answer.");
		const answers: Record<string, number> = {};
		for (const [key, answer] of Object.entries(result.answers ?? {})) {
			if (answer && typeof answer === "object" && "probability" in answer) answers[key] = Number(answer.probability);
		}
		return { answers, model: modelId };
	}

	private record(purpose: string, model: string, pricing: Pricing, message: AssistantMessage, error?: string) {
		this.recordCost({
			purpose,
			model,
			pricing,
			inputTokens: message.usage?.input ?? 0,
			outputTokens: message.usage?.output ?? 0,
			cost: message.usage?.cost?.total ?? 0,
			...(error ? { error } : {}),
		});
	}
}

function extractToolArguments<Output>(message: AssistantMessage, toolName: string): Output {
	const call = message.content.find((block) => block.type === "toolCall" && block.name === toolName) ?? message.content.find((block) => block.type === "toolCall");
	if (call && call.type === "toolCall") return call.arguments as Output;
	const text = message.content
		.filter((block) => block.type === "text")
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
	const json = /\{[\s\S]*\}/.exec(text)?.[0];
	if (json) {
		try {
			return JSON.parse(json) as Output;
		} catch {
			// fall through to the error below
		}
	}
	throw new AiError("The model did not return a usable answer. Try again or pick another mode.");
}
