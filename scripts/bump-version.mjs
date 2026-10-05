// Bumps the plugin version everywhere Obsidian and npm read it:
// manifest.json, package.json, package-lock.json and versions.json.
// Usage: node scripts/bump-version.mjs patch|minor|major|<x.y.z>
// Prints the new version.
import { readFileSync, writeFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value, indent) => writeFileSync(path, `${JSON.stringify(value, null, indent)}\n`);

const manifest = readJson("manifest.json");
const requested = process.argv[2] ?? "patch";
const [major, minor, patch] = manifest.version.split(".").map(Number);
const next =
	requested === "major" ? `${major + 1}.0.0`
	: requested === "minor" ? `${major}.${minor + 1}.0`
	: requested === "patch" ? `${major}.${minor}.${patch + 1}`
	: requested;
if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error(`"${requested}" is not patch, minor, major or a version like 1.2.3`);

manifest.version = next;
writeJson("manifest.json", manifest, 2);

const pkg = readJson("package.json");
pkg.version = next;
writeJson("package.json", pkg, 2);

const lock = readJson("package-lock.json");
lock.version = next;
lock.packages[""].version = next;
writeJson("package-lock.json", lock, 2);

const versions = readJson("versions.json");
versions[next] = manifest.minAppVersion;
writeJson("versions.json", versions, "\t");

console.log(next);
