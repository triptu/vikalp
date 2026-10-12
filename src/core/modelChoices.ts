import type { ModelMode } from "./settings";

/** A model the writer can pick, with the name to show for it. */
export interface ModelChoice {
	id: string;
	name: string;
}

/** Open models suggested for each mode on OpenRouter. */
export type OpenModelPicks = Record<ModelMode, ModelChoice[]>;

/**
 * Model families offered for each mode, in the order they are listed. Each
 * pattern matches the family's ids on OpenRouter ("openai/gpt-6-luna") and on
 * the maker's own API ("gpt-6-luna", "claude-haiku-5-5"), and captures the version.
 */
const FAMILIES: Record<ModelMode, RegExp[]> = {
	lite: [/^(?:openai\/)?gpt-(\d+(?:\.\d+)?)-luna$/, /^(?:anthropic\/)?claude-haiku-(\d+(?:[.-]\d+)?)$/],
	medium: [/^(?:openai\/)?gpt-(\d+(?:\.\d+)?)-sol$/, /^(?:anthropic\/)?claude-sonnet-(\d+(?:[.-]\d+)?)$/],
	heavy: [/^(?:openai\/)?gpt-(\d+(?:\.\d+)?)-astra$/, /^(?:anthropic\/)?claude-opus-(\d+(?:[.-]\d+)?)$/, /^(?:anthropic\/)?claude-fable-(\d+(?:[.-]\d+)?)$/],
};

/** The newest model of each family for this mode that the provider offers. */
export function familyChoices(available: ModelChoice[], mode: ModelMode): ModelChoice[] {
	return FAMILIES[mode].flatMap((family) => {
		const newest = available
			.map((model) => ({ model, version: family.exec(model.id)?.[1] }))
			.filter((match): match is { model: ModelChoice; version: string } => match.version !== undefined)
			.sort((a, b) => compareVersions(b.version, a.version))[0];
		return newest ? [newest.model] : [];
	});
}

/** "OpenAI: GPT-6 Luna" becomes "GPT-6 Luna". */
export function shortModelName(name: string): string {
	return name.replace(/^[^:]+:\s*/, "");
}

/** One Artificial Analysis score, as OpenRouter's benchmarks API reports it. */
export interface BenchmarkScore {
	/** Dated slug, matching a model's `canonical_slug`. */
	slug: string;
	intelligence: number;
}

/** What OpenRouter's model list says about one model. */
export interface OpenRouterModelInfo {
	id: string;
	canonicalSlug: string;
	name: string;
	/** Set for models with open weights. */
	huggingFaceId: string | null;
	supportsTools: boolean;
	/** Dollars per million output tokens. */
	outputPrice: number;
}

/** Most an open model may cost per million output tokens to be offered for a mode, in line with the closed models there. */
const OUTPUT_PRICE_CEILING: Record<ModelMode, number> = { heavy: Number.POSITIVE_INFINITY, medium: 10, lite: 1 };
const PICKS_PER_MODE = 2;

/**
 * Picks open models for each mode: the highest intelligence scores among
 * models with open weights and tool calls (every Vikalp request needs one),
 * under the mode's price ceiling. Heavy picks first, and a model is offered
 * for one mode only.
 */
export function pickOpenModels(scores: BenchmarkScore[], models: OpenRouterModelInfo[]): OpenModelPicks {
	const bySlug = new Map(models.filter(isStable).map((model) => [model.canonicalSlug, model]));
	const ranked = scores
		.flatMap((score) => {
			const model = bySlug.get(score.slug);
			return model?.huggingFaceId && model.supportsTools ? [{ model, intelligence: score.intelligence }] : [];
		})
		.sort((a, b) => b.intelligence - a.intelligence);
	const taken = new Set<string>();
	const pick = (mode: ModelMode): ModelChoice[] => {
		const chosen = ranked.filter(({ model }) => !taken.has(model.id) && model.outputPrice <= OUTPUT_PRICE_CEILING[mode]).slice(0, PICKS_PER_MODE);
		for (const { model } of chosen) taken.add(model.id);
		return chosen.map(({ model }) => ({ id: model.id, name: shortModelName(model.name) }));
	};
	const heavy = pick("heavy");
	const medium = pick("medium");
	return { lite: pick("lite"), medium, heavy };
}

/**
 * Leaves out variants like ":batch" and ":free", which share the base model's
 * slug, and preview or experimental models, which can disappear.
 */
function isStable(model: OpenRouterModelInfo): boolean {
	return !model.id.includes(":") && !/\b(preview|exp|experimental|beta)\b/i.test(model.id);
}

function compareVersions(a: string, b: string): number {
	const left = a.split(/[.-]/).map(Number);
	const right = b.split(/[.-]/).map(Number);
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}
