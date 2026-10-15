import { pickOpenModels, type BenchmarkScore, type OpenModelPicks, type OpenRouterModelInfo } from "../core/modelChoices";
import { AiError } from "./backend";

const OPENROUTER_API = "https://openrouter.ai/api/v1";

/**
 * Asks OpenRouter for Artificial Analysis intelligence scores and its model
 * list, and picks open models for each mode. The benchmarks need an OpenRouter key.
 */
export async function fetchOpenModelPicks(apiKey: string, signal?: AbortSignal): Promise<OpenModelPicks> {
	const [benchmarks, catalog] = await Promise.all([
		getJson(`${OPENROUTER_API}/benchmarks?source=artificial-analysis&task_type=intelligence&max_results=100`, apiKey, signal),
		getJson(`${OPENROUTER_API}/models`, apiKey, signal),
	]);
	return pickOpenModels(readScores(benchmarks), readModels(catalog));
}

async function getJson(url: string, apiKey: string, signal?: AbortSignal): Promise<unknown> {
	const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
	if (!response.ok) throw new AiError(`OpenRouter answered with error ${response.status}.`);
	return response.json();
}

function readScores(body: unknown): BenchmarkScore[] {
	return listOf(body).flatMap((entry) => {
		const slug = entry.model_permaslug;
		const intelligence = entry.intelligence_index;
		return typeof slug === "string" && typeof intelligence === "number" ? [{ slug, intelligence }] : [];
	});
}

function readModels(body: unknown): OpenRouterModelInfo[] {
	return listOf(body).flatMap((entry) => {
		const { id, canonical_slug: canonicalSlug, name, hugging_face_id: huggingFaceId, supported_parameters: parameters, pricing } = entry;
		if (typeof id !== "string" || typeof name !== "string") return [];
		const outputPerToken = Number((pricing as { completion?: unknown } | undefined)?.completion);
		return [
			{
				id,
				canonicalSlug: typeof canonicalSlug === "string" ? canonicalSlug : id,
				name,
				huggingFaceId: typeof huggingFaceId === "string" && huggingFaceId ? huggingFaceId : null,
				supportsTools: Array.isArray(parameters) && parameters.includes("tools"),
				outputPrice: Number.isFinite(outputPerToken) ? outputPerToken * 1_000_000 : Number.POSITIVE_INFINITY,
			},
		];
	});
}

function listOf(body: unknown): Array<Record<string, unknown>> {
	const list = (body as { data?: unknown } | null)?.data;
	return Array.isArray(list) ? list.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null) : [];
}
