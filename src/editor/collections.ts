import type { GhostMeta, LintHit } from "../core/model/types";
import { createRangeCollection } from "./rangeCollection";

export const ghosts = createRangeCollection<GhostMeta>({ undoable: true });

export type LintMarkMeta = Omit<LintHit, "from" | "to">;
export const lintMarks = createRangeCollection<LintMarkMeta>({ undoable: false });

export interface TrimProposalMeta {
	id: string;
	why: string;
	words: number;
	/** Set when a grammar check says the cut may leave a broken sentence. */
	risky?: boolean;
}
export const trimProposals = createRangeCollection<TrimProposalMeta>({ undoable: false });
