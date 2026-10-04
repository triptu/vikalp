import { emptyNoteFile, type NoteFile } from "../core/model/types";

const CURRENT_SCHEMA = 1;

/**
 * Brings a sidecar read from disk up to the current schema. Each breaking
 * change to `NoteFile` bumps the schema and adds a step here.
 */
export function migrateNoteFile(raw: unknown, notePath: string): NoteFile {
	if (!raw || typeof raw !== "object") return emptyNoteFile(notePath, false);
	const candidate = raw as Partial<NoteFile> & { schema?: number };
	if ((candidate.schema ?? 0) > CURRENT_SCHEMA) {
		console.warn(`Vikalp: sidecar for ${notePath} uses a newer schema (${candidate.schema}); reading what it can.`);
	}
	return {
		schema: 1,
		path: typeof candidate.path === "string" ? candidate.path : notePath,
		markersOn: candidate.markersOn === true,
		spans: Array.isArray(candidate.spans) ? candidate.spans.filter((span) => span && Array.isArray(span.versions) && span.versions.length > 0 && span.anchor) : [],
		ghosts: Array.isArray(candidate.ghosts) ? candidate.ghosts.filter((ghost) => ghost && ghost.anchor) : [],
		overflow: Array.isArray(candidate.overflow) ? candidate.overflow.filter((block) => block && typeof block.text === "string") : [],
		...(candidate.lint && Array.isArray(candidate.lint.hits) ? { lint: candidate.lint } : {}),
	};
}
