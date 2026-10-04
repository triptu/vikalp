export interface TextRange {
	from: number;
	to: number;
}

export type SpanUnit = "word" | "sentence" | "paragraph";

/** Where a piece of text sits in a note, robust to edits made elsewhere. */
export interface Anchor {
	start: number;
	end: number;
	/** The text at the anchor when it was last saved. */
	exact: string;
	/** Up to 32 characters before `exact`. */
	prefix: string;
	/** Up to 32 characters after `exact`. */
	suffix: string;
}

export type VersionSource = "human" | "ai";

export interface Version {
	id: string;
	text: string;
	source: VersionSource;
	/** OpenRouter model id, set when `source` is "ai". */
	model?: string;
	createdAt: number;
}

/** A spot in the note with two or more versions. The active version is the document text. */
export interface SpanMeta {
	id: string;
	unit: SpanUnit;
	activeVersion: string;
	versions: Version[];
	note?: string;
	/** Set when the enclosing paragraph span switched to a version that does not contain this span. */
	hiddenIn?: string;
	/** The text this span had when it was hidden or orphaned, used to place it again. */
	lastText?: string;
	/** Set when re-anchoring failed. Orphans are listed in the panel but not drawn. */
	orphaned?: boolean;
}

export interface GhostMeta {
	id: string;
	createdAt: number;
}

export interface OverflowBlock {
	id: string;
	text: string;
	createdAt: number;
}

export type Severity = "suggestion" | "warning" | "error";
export type LintScope = "sentence" | "paragraph" | "document";

export interface LintHit {
	id: string;
	ruleId: string;
	label: string;
	message: string;
	severity: Severity;
	scope: LintScope;
	from: number;
	to: number;
	/** Replacement text, for substitution rules and the typo pass. */
	suggestion?: string;
	/** "lab" for marks made by an AI pass. */
	source: "rule" | "lab";
	model?: string;
}

export interface StoredLintHit extends Omit<LintHit, "from" | "to"> {
	anchor: Anchor;
}

/** The sidecar file for one note. */
export interface NoteFile {
	schema: 1;
	path: string;
	markersOn: boolean;
	spans: Array<SpanMeta & { anchor: Anchor }>;
	ghosts: Array<GhostMeta & { anchor: Anchor }>;
	overflow: OverflowBlock[];
	lint?: { ranAt: number; hits: StoredLintHit[] };
}

export function emptyNoteFile(path: string, markersOn: boolean): NoteFile {
	return { schema: 1, path, markersOn, spans: [], ghosts: [], overflow: [] };
}
