// Replaces pi-ai's utils/provider-env.js in the bundle. The original also reads
// /proc/self/environ through node:fs as a fallback for Bun sandboxes, a path
// Obsidian never takes, and Obsidian's review flags any filesystem access.
export function getProviderEnvValue(name, env) {
	return env?.[name] || (typeof process !== "undefined" ? process.env[name] : undefined) || undefined;
}
