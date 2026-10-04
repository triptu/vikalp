import { defineConfig } from "vitest/config";

export default defineConfig({
	oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
	test: {
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		environment: "node",
	},
	resolve: {
		alias: { obsidian: new URL("./tests/support/obsidian-stub.ts", import.meta.url).pathname },
	},
});
