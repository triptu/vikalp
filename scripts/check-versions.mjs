// Fails when the version fields Obsidian and npm read disagree.
import { readFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const versions = readJson("versions.json");

if (pkg.version !== manifest.version) throw new Error(`package.json is ${pkg.version}, manifest.json is ${manifest.version}`);
if (lock.version !== manifest.version || lock.packages[""].version !== manifest.version) throw new Error(`package-lock.json is ${lock.version}, manifest.json is ${manifest.version}`);
if (versions[manifest.version] !== manifest.minAppVersion) throw new Error(`versions.json needs "${manifest.version}": "${manifest.minAppVersion}"`);
console.log(`versions agree: ${manifest.version} (minAppVersion ${manifest.minAppVersion})`);
