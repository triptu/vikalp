import type { AssistantMessage, ClassifierModel, Context, Model, Tool } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { TSchema } from "typebox";
import type { ModelMode, VikalpSettings } from "../core/settings";

export class AiError extends Error {}

export interface CostRecord {
	purpose: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cost: number;
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
 * Talks to OpenRouter through pi-ai. Every call records its cost. The API key
 * comes from settings on each call, since the renderer has no environment.
 */
export class AiClient {
	private readonly models = createModels();

	constructor(
		private readonly getSettings: () => VikalpSettings,
		private readonly recordCost: (record: CostRecord) => void,
	) {
		this.models.setProvider(openrouterProvider());
	}

	get hasKey(): boolean {
		return this.getSettings().openRouterApiKey.trim().length > 0;
	}

	modelId(mode: ModelMode): string {
		return this.getSettings().models[mode];
	}

	private apiKey(): string {
		const key = this.getSettings().openRouterApiKey.trim();
		if (!key) throw new AiError("Add an OpenRouter API key in Vikalp settings first.");
		return key;
	}

	private chatModel(mode: ModelMode): Model<never> {
		const id = this.modelId(mode);
		const known = this.models.getModel("openrouter", id);
		if (known) return known as Model<never>;
		const template = this.models.getModel("openrouter", "openai/gpt-6-luna");
		if (!template) throw new AiError(`Unknown model "${id}".`);
		return { ...template, id, name: id, api: "openai-completions", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as unknown as Model<never>;
	}

	/** Asks a chat model for output shaped by `schema`, via a single tool call. */
	async structured<Output>(request: StructuredRequest<Output>): Promise<{ value: Output; model: string }> {
		const apiKey = this.apiKey();
		const model = this.chatModel(request.mode);
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
		const stream = this.models.streamSimple(model, context, { apiKey, signal: request.signal, reasoning: "low", maxTokens: 8000 });
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
		this.record(request.purpose, model.id, message, streamError ?? undefined);
		if (streamError) throw new AiError(friendlyError(streamError));
		return { value: extractToolArguments<Output>(message, request.toolName), model: model.id };
	}

	/** Yes/no judgments from Jev, TypeSafe's decision model. Returns a probability per question. */
	async classify(purpose: string, state: Record<string, unknown>, questions: Record<string, ClassifyQuestion>, signal?: AbortSignal): Promise<ClassifyResult> {
		const apiKey = this.apiKey();
		const modelId = this.getSettings().jevModel;
		const model = this.models.getModelOfType("classifier", "openrouter", modelId) as ClassifierModel<never> | undefined;
		if (!model) throw new AiError(`Jev model "${modelId}" is not available.`);
		const result = await this.models.classify(model, { state: state as never, questions }, { apiKey, signal });
		const usage = result.usage;
		const failed = result.stopReason === "error";
		this.recordCost({
			purpose,
			model: modelId,
			inputTokens: usage?.input ?? 0,
			outputTokens: usage?.output ?? 0,
			cost: usage?.cost.total ?? 0,
			...(failed ? { error: result.errorMessage ?? "failed" } : {}),
		});
		if (failed) throw new AiError(result.errorMessage ?? "Jev could not answer.");
		const answers: Record<string, number> = {};
		for (const [key, answer] of Object.entries(result.answers ?? {})) {
			if (answer && typeof answer === "object" && "probability" in answer) answers[key] = Number(answer.probability);
		}
		return { answers, model: modelId };
	}

	private record(purpose: string, model: string, message: AssistantMessage, error?: string) {
		this.recordCost({
			purpose,
			model,
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

function friendlyError(raw: string): string {
	if (/401|unauthor|invalid api key|no auth/i.test(raw)) return "OpenRouter rejected the API key. Check it in Vikalp settings.";
	if (/402|credit|insufficient/i.test(raw)) return "OpenRouter says the account is out of credits.";
	if (/429|rate/i.test(raw)) return "OpenRouter is rate limiting. Wait a moment and try again.";
	if (/abort/i.test(raw)) return "Cancelled.";
	return `The model call failed: ${raw}`;
}
