import type { App, SecretStorage } from "obsidian";
import type { ProviderId } from "../core/providers";
import type { ApiKeyStore } from "../core/settings";

/** Secret storage ids are lowercase letters, digits and dashes; provider ids already are. */
const secretId = (provider: ProviderId) => `vikalp-api-key-${provider}`;

/** Vikalp's keys in Obsidian's secret storage, one entry per provider. Null on an Obsidian without it. */
export function secretApiKeyStore(app: App): ApiKeyStore | null {
	const storage = Reflect.get(app, "secretStorage") as SecretStorage | undefined;
	if (!storage) return null;
	return {
		read: (provider) => storage.getSecret(secretId(provider)),
		write: (provider, key) => storage.setSecret(secretId(provider), key),
	};
}
