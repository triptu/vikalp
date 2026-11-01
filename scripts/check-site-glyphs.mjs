// Fails when the site shows a character that none of its self-hosted fonts contain.
// Such a character falls back to whatever font the visitor's device has, so it can
// come out in another size or style on each phone. Run: node scripts/check-site-glyphs.mjs
//
// It serves site/, walks the page in Chromium at desktop and phone sizes (with a
// touch screen, so the touch wording is checked too) through every story step and
// panel, and checks each rendered character against the cmap of the @font-face file
// its font-family list would use.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { chromium } from "playwright-core";

const SITE = new URL("../site/", import.meta.url).pathname;

/* ---------- the characters a woff2 file maps ---------- */
function readBase128(bytes, at) {
  let value = 0;
  for (let n = 0; n < 5; n++) {
    const b = bytes[at.pos++];
    value = value * 128 + (b & 0x7f);
    if (!(b & 0x80)) return value;
  }
  throw new Error("bad UIntBase128");
}

function woff2Codepoints(path) {
  const file = readFileSync(path);
  if (file.toString("latin1", 0, 4) !== "wOF2") throw new Error(`${path} is not woff2`);
  const numTables = file.readUInt16BE(12);
  const compressedSize = file.readUInt32BE(20);
  const at = { pos: 48 };
  const tables = [];
  for (let t = 0; t < numTables; t++) {
    const flags = file[at.pos++];
    const tagIndex = flags & 0x3f;
    if (tagIndex === 63) at.pos += 4;
    const version = flags >> 6;
    const origLength = readBase128(file, at);
    const glyfOrLoca = tagIndex === 10 || tagIndex === 11;
    const transformed = glyfOrLoca ? version !== 3 : version !== 0;
    const length = transformed ? readBase128(file, at) : origLength;
    tables.push({ tagIndex, length });
  }
  const sfnt = brotliDecompressSync(file.subarray(at.pos, at.pos + compressedSize));
  let offset = 0;
  for (const table of tables) {
    if (table.tagIndex === 0) return cmapCodepoints(sfnt, offset);
    offset += table.length;
  }
  throw new Error(`${path} has no cmap`);
}

function cmapCodepoints(buf, cmap) {
  const points = new Set();
  const count = buf.readUInt16BE(cmap + 2);
  for (let r = 0; r < count; r++) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + r * 8 + 4);
    const format = buf.readUInt16BE(sub);
    if (format === 4) {
      const segs = buf.readUInt16BE(sub + 6) / 2;
      const ends = sub + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
      for (let s = 0; s < segs; s++) {
        const end = buf.readUInt16BE(ends + s * 2), start = buf.readUInt16BE(starts + s * 2);
        const delta = buf.readInt16BE(deltas + s * 2), rangeAt = ranges + s * 2, range = buf.readUInt16BE(rangeAt);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const glyph = range === 0 ? (c + delta) & 0xffff : buf.readUInt16BE(rangeAt + range + (c - start) * 2);
          if (glyph) points.add(c);
        }
      }
    } else if (format === 12) {
      const groups = buf.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const start = buf.readUInt32BE(sub + 16 + g * 12), end = buf.readUInt32BE(sub + 20 + g * 12);
        for (let c = start; c <= end; c++) points.add(c);
      }
    }
  }
  return points;
}

/* ---------- which font a character in a given font-family list lands in ---------- */
const inRanges = (ranges, c) => !ranges || ranges.some(([a, b]) => c >= a && c <= b);

function makeResolver(faces) {
  const cmaps = new Map();
  const cmapOf = face => {
    if (!cmaps.has(face.file)) cmaps.set(face.file, woff2Codepoints(join(SITE, face.file)));
    return cmaps.get(face.file);
  };
  // The face of a family closest to the weight asked for, as the browser picks it.
  const faceFor = (family, weight) => {
    const own = faces.filter(f => f.family === family);
    const distance = f => (weight >= f.weight[0] && weight <= f.weight[1] ? 0 : Math.min(Math.abs(weight - f.weight[0]), Math.abs(weight - f.weight[1])));
    return own.sort((a, b) => distance(a) - distance(b));
  };
  // The self-hosted font that draws c, or null when the device's own fallback would.
  return (c, families, weight) => {
    for (const family of families) {
      const candidates = faceFor(family, weight).filter(f => inRanges(f.ranges, c));
      if (!candidates.length) {
        if (faces.some(f => f.family === family)) continue;
        return null;
      }
      if (cmapOf(candidates[0]).has(c)) return candidates[0].file;
    }
    return null;
  };
}

/* ---------- the page ---------- */
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg" };
const server = createServer((req, res) => {
  let path = normalize(join(SITE, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(SITE) || !existsSync(path)) { res.writeHead(404).end(); return; }
  if (statSync(path).isDirectory()) path = join(path, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/`;

// Every rendered text run on the page now: its text, font-family list and weight.
function collectRuns() {
  const runs = [];
  const families = s => s.fontFamily.split(",").map(f => f.trim().replace(/^["']|["']$/g, ""));
  const visible = el => el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : true;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.data.trim() || !el || !visible(el) || el.closest("script, style")) continue;
    const s = getComputedStyle(el);
    runs.push({ text: n.data, families: families(s), weight: +s.fontWeight, where: el.className || el.tagName.toLowerCase() });
  }
  for (const el of document.querySelectorAll("*")) {
    for (const pseudo of ["::before", "::after"]) {
      const s = getComputedStyle(el, pseudo);
      const m = s.content.match(/^"(.+)"$/);
      if (m && visible(el)) runs.push({ text: m[1], families: families(s), weight: +s.fontWeight, where: `${el.className || el.tagName.toLowerCase()}${pseudo}` });
    }
  }
  return runs;
}

function readFaces() {
  const faces = [];
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const st = rule.style;
      const weight = (st.getPropertyValue("font-weight") || "400").split(/\s+/).map(Number);
      const range = st.getPropertyValue("unicode-range");
      faces.push({
        family: st.getPropertyValue("font-family").replace(/^["']|["']$/g, ""),
        weight: [weight[0], weight[1] ?? weight[0]],
        file: st.getPropertyValue("src").match(/url\("?([^")]+)"?\)/)[1].replace(location.origin + "/", ""),
        ranges: range ? range.split(",").map(r => r.trim().replace(/^U\+/i, "").split("-").map(h => parseInt(h, 16))).map(([a, b]) => [a, b ?? a]) : null,
      });
    }
  }
  return faces;
}

const browser = await chromium.launch();
const runs = [];
let faces;
const VIEWS = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
for (const view of VIEWS) {
  const page = await browser.newPage(view);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  faces ??= await page.evaluate(readFaces);
  const grab = async label => { for (const r of await page.evaluate(collectRuns)) runs.push({ ...r, view: `${view.name} ${label}` }); };
  await grab("top");
  const steps = await page.evaluate(() => __story.steps.length);
  for (let i = 0; i < steps; i++) {
    await page.evaluate(i => __story.steps[i].scrollIntoView({ block: "center" }), i);
    await page.waitForFunction(i => __story.settled() && __story.active() === i, i, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(150);
    await grab(`step ${i + 1}`);
    // Open what each step's panel can show: every lint reason and every trim.
    for (const sel of ["#storyNote .vk-lint.is-on", "#storyNote [data-trim]"]) {
      const count = await page.locator(sel).count();
      for (let k = 0; k < count; k++) {
        await page.evaluate(([sel, k]) => document.querySelectorAll(sel)[k].click(), [sel, k]);
        await page.waitForTimeout(100);
        await grab(`step ${i + 1} after ${sel}`);
      }
    }
  }
  await page.evaluate(() => document.querySelector(".step:not([hidden]) .step-clip").click());
  await grab("clip open");
  if (errors.length) throw new Error(`page errors at ${view.name}: ${errors.join("; ")}`);
  await page.close();
}
await browser.close();
server.close();

const resolve = makeResolver(faces);
const missing = new Map();
const usage = new Map();
for (const run of runs) {
  for (const ch of run.text) {
    const c = ch.codePointAt(0);
    if (c === 0x0a || c === 0x09 || c === 0x0d) continue;
    const file = resolve(c, run.families, run.weight);
    if (file) { usage.set(file, (usage.get(file) || 0) + 1); continue; }
    const key = `U+${c.toString(16).toUpperCase().padStart(4, "0")} ${ch} in ${run.families[0]} ${run.weight}`;
    if (!missing.has(key)) missing.set(key, new Set());
    missing.get(key).add(`${run.where} (${run.view})`);
  }
}

console.log(`checked ${runs.length} text runs; characters per font file:`);
for (const [file, n] of usage) console.log(`  ${file}: ${n}`);
if (missing.size) {
  console.log(`\n${missing.size} characters fall back to the device's own fonts:`);
  for (const [key, where] of missing) console.log(`  ${key}: ${[...where].slice(0, 3).join("; ")}`);
  process.exit(1);
}
console.log("every character is in the self-hosted font it is set in");
