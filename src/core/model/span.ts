import { newId } from "./ids";
import type { SpanMeta, SpanUnit, Version, VersionSource } from "./types";

export function createSpanMeta(text: string, unit: SpanUnit, now = Date.now()): SpanMeta {
	const original: Version = { id: newId("v"), text, source: "human", createdAt: now };
	return { id: newId("sp"), unit, activeVersion: original.id, versions: [original] };
}

export function createVersion(text: string, source: VersionSource, model?: string, now = Date.now()): Version {
	return model ? { id: newId("v"), text, source, model, createdAt: now } : { id: newId("v"), text, source, createdAt: now };
}

export function activeIndex(span: SpanMeta): number {
	return Math.max(0, span.versions.findIndex((version) => version.id === span.activeVersion));
}

export function activeVersionOf(span: SpanMeta): Version {
	return span.versions[activeIndex(span)]!;
}

/** The version `step` places away from the active one, wrapping around. */
export function versionAtStep(span: SpanMeta, step: number): Version {
	const count = span.versions.length;
	const index = (((activeIndex(span) + step) % count) + count) % count;
	return span.versions[index]!;
}

/** Records the text currently in the document as the active version's text. */
export function syncActiveText(span: SpanMeta, documentText: string): SpanMeta {
	const active = activeVersionOf(span);
	if (active.text === documentText) return span;
	return { ...span, versions: span.versions.map((version) => (version.id === active.id ? { ...version, text: documentText } : version)) };
}

export function isDuplicateVersion(span: SpanMeta, text: string): boolean {
	const normalized = normalizeForCompare(text);
	return span.versions.some((version) => normalizeForCompare(version.text) === normalized);
}

export function normalizeForCompare(text: string): string {
	return text.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").toLowerCase();
}

/**
 * Which version becomes active after deleting `versionId`. The panel prefers
 * the previous version; deleting inline while hovering prefers the next one.
 */
export function versionAfterDelete(span: SpanMeta, versionId: string, prefer: "previous" | "next" = "previous"): Version | null {
	const index = span.versions.findIndex((version) => version.id === versionId);
	if (index === -1 || span.versions.length < 2) return null;
	const count = span.versions.length;
	const neighbour = prefer === "next" ? (index + 1) % count : index === 0 ? 1 : index - 1;
	return span.versions[neighbour]!;
}
