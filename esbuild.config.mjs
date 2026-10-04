import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs";

const production = process.argv[2] === "production";
const devPluginDir = "dev-vault/.obsidian/plugins/vikalp";

const copyToDevVault = {
	name: "copy-to-dev-vault",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length > 0) return;
			mkdirSync(devPluginDir, { recursive: true });
			for (const file of ["main.js", "manifest.json", "styles.css"]) {
				if (existsSync(file)) copyFileSync(file, `${devPluginDir}/${file}`);
			}
			const hotReloadMarker = `${devPluginDir}/.hotreload`;
			if (!existsSync(hotReloadMarker)) writeFileSync(hotReloadMarker, "");
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
		...builtinModules.map((name) => `node:${name}`),
	],
	alias: {
		react: "preact/compat",
		"react-dom": "preact/compat",
		"react/jsx-runtime": "preact/jsx-runtime",
	},
	jsx: "automatic",
	jsxImportSource: "preact",
	format: "cjs",
	platform: "browser",
	target: "es2022",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	minify: production,
	outfile: "main.js",
	plugins: [copyToDevVault],
});

if (production) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
