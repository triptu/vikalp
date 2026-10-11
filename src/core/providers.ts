import type { ModelMode } from "./settings";

export type ProviderId = "openrouter" | "anthropic" | "openai" | "ollama" | "lmstudio" | "custom";

/** How Vikalp talks to a server, picked from its URL. */
export type Protocol = "openrouter" | "anthropic" | "openai" | "openai-compatible";

export interface ProviderPreset {
	id: ProviderId;
	label: string;
	/** Empty for Custom, where the writer types the URL. */
	baseUrl: string;
	key: "required" | "optional" | "none";
	keyPlaceholder: string;
	/** Named providers offer Lite, Medium and Heavy. The rest run one model the writer picks. */
	modes: Record<ModelMode, string> | null;
	/** What to call the server in messages, e.g. "Is Ollama running?" */
	serverName: string;
}

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
	openrouter: {
		id: "openrouter",
		label: "OpenRouter",
		baseUrl: "https://openrouter.ai/api/v1",
		key: "required",
		keyPlaceholder: "sk-or-…",
		modes: { lite: "openai/gpt-6-luna", medium: "anthropic/claude-sonnet-5.5", heavy: "anthropic/claude-opus-5.5" },
		serverName: "OpenRouter",
	},
	anthropic: {
		id: "anthropic",
		label: "Anthropic",
		baseUrl: "https://api.anthropic.com",
		key: "required",
		keyPlaceholder: "sk-ant-…",
		modes: { lite: "claude-haiku-4-5", medium: "claude-sonnet-5-5", heavy: "claude-opus-5-5" },
		serverName: "Anthropic",
	},
	openai: {
		id: "openai",
		label: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		key: "required",
		keyPlaceholder: "sk-…",
		modes: { lite: "gpt-6-luna", medium: "gpt-6-sol", heavy: "gpt-5.6-sol" },
		serverName: "OpenAI",
	},
	ollama: {
		id: "ollama",
		label: "Ollama",
		baseUrl: "http://localhost:11434/v1",
		key: "none",
		keyPlaceholder: "",
		modes: null,
		serverName: "Ollama",
	},
	lmstudio: {
		id: "lmstudio",
		label: "LM Studio",
		baseUrl: "http://localhost:1234/v1",
		key: "none",
		keyPlaceholder: "",
		modes: null,
		serverName: "LM Studio's server",
	},
	custom: {
		id: "custom",
		label: "Custom",
		baseUrl: "",
		key: "optional",
		keyPlaceholder: "Optional",
		modes: null,
		serverName: "the server",
	},
};

export const PROVIDER_IDS = Object.keys(PROVIDER_PRESETS) as ProviderId[];

/** The protocol a server speaks, judged by its host. Anything unknown is treated as OpenAI-compatible. */
export function protocolFor(baseUrl: string): Protocol {
	const host = hostOf(baseUrl);
	if (host === "openrouter.ai") return "openrouter";
	if (host === "api.anthropic.com") return "anthropic";
	// OpenAI also serves regional hosts such as eu.api.openai.com.
	if (host === "api.openai.com" || host.endsWith(".api.openai.com")) return "openai";
	return "openai-compatible";
}

/** True when calls cost nothing: Ollama or LM Studio on this computer. A custom server on localhost may be a proxy to a paid API. */
export function runsLocally(provider: ProviderId, baseUrl: string): boolean {
	return (provider === "ollama" || provider === "lmstudio") && isLocalUrl(baseUrl);
}

function isLocalUrl(baseUrl: string): boolean {
	const host = hostOf(baseUrl);
	return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0";
}

/** "localhost:11434" for messages, or the URL as typed when it can't be parsed. */
export function shortServerName(baseUrl: string): string {
	try {
		return new URL(baseUrl).host || baseUrl;
	} catch {
		return baseUrl;
	}
}

/** Adds the http:// a writer often leaves off ("localhost:11434/v1"), so the URL parses as they meant. */
export function withScheme(baseUrl: string): string {
	const url = baseUrl.trim();
	return url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? `http://${url}` : url;
}

function hostOf(baseUrl: string): string {
	try {
		return new URL(baseUrl.trim()).hostname.toLowerCase();
	} catch {
		return "";
	}
}
