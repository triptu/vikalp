import { history, redo, undo } from "@codemirror/commands";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
	addVersionToSpan,
	createSpanFromSelection,
	cycleSpan,
	deleteAllGhosts,
	deleteVersionFromSpan,
	ghostRange,
	insertOverflowBlock,
	removeAiVersions,
	reviveRange,
	settleSpans,
	stashRange,
	switchToVersion,
} from "../../src/editor/actions";
import { ghosts } from "../../src/editor/collections";
import { flashField, noteModeField, overflowField } from "../../src/editor/noteFields";
import { listSpans, spanMeta, spanRange, spansField } from "../../src/editor/spansField";
import { activeVersionOf } from "../../src/core/model/span";
import { isolated } from "../../src/editor/transactions";

const options = { articleFix: true };

class Editor {
	state: EditorState;
	constructor(doc: string) {
		this.state = EditorState.create({ doc, extensions: [history(), spansField, ghosts.extensions, overflowField, noteModeField, flashField] });
	}
	get doc() {
		return this.state.doc.toString();
	}
	apply(result: { ok: true; spec: TransactionSpec } | { ok: false; message: string }) {
		if (!result.ok) throw new Error(result.message);
		this.state = this.state.update(isolated(result.spec)).state;
		return result;
	}
	type(from: number, to: number, insert: string) {
		this.state = this.state.update({ changes: { from, to, insert }, userEvent: insert ? "input.type" : "delete" }).state;
	}
	undo() {
		undo({ state: this.state, dispatch: (tr) => (this.state = tr.state) });
	}
	redo() {
		redo({ state: this.state, dispatch: (tr) => (this.state = tr.state) });
	}
	select(text: string, occurrence = 0) {
		let from = -1;
		for (let index = 0; index <= occurrence; index++) from = this.doc.indexOf(text, from + 1);
		if (from === -1) throw new Error(`"${text}" not in doc`);
		return { from, to: from + text.length };
	}
	spanText(id: string) {
		const range = spanRange(this.state, id);
		return range ? this.doc.slice(range.from, range.to) : null;
	}
	createSpan(text: string) {
		const result = createSpanFromSelection(this.state, this.select(text));
		this.apply(result);
		if (!result.ok) throw new Error();
		return result.spanId;
	}
	addVersion(id: string, text: string, activate = true) {
		this.apply(addVersionToSpan(this.state, id, text, "human", { ...options, activate }));
	}
}

const essay = "Much of the tension in product development comes from balance. It is like a thumbtack, for example.";

describe("alternatives", () => {
	it("adding a version shows it in place, and cycling walks through all of them", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		expect(editor.doc).toContain("Much of the pressure in product");
		editor.addVersion(id, "friction");
		expect(editor.spanText(id)).toBe("friction");

		editor.apply(cycleSpan(editor.state, id, 1, options));
		expect(editor.spanText(id)).toBe("tension");
		editor.apply(cycleSpan(editor.state, id, -1, options));
		expect(editor.spanText(id)).toBe("friction");
	});

	it("undo reverses a swap: the text and the active version both go back", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		editor.apply(cycleSpan(editor.state, id, 1, options));
		expect(editor.spanText(id)).toBe("tension");
		editor.undo();
		expect(editor.spanText(id)).toBe("pressure");
		expect(activeVersionOf(spanMeta(editor.state, id)!).text).toBe("pressure");
		editor.redo();
		expect(editor.spanText(id)).toBe("tension");
	});

	it("fixes a/an before the span as part of the same edit", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("thumbtack");
		editor.addVersion(id, "eraser");
		expect(editor.doc).toContain("like an eraser,");
		editor.apply(cycleSpan(editor.state, id, 1, options));
		expect(editor.doc).toContain("like a thumbtack,");
		editor.undo();
		expect(editor.doc).toContain("like an eraser,");
	});

	it("a partial word selection becomes a span on the whole word", () => {
		const editor = new Editor(essay);
		const result = createSpanFromSelection(editor.state, editor.select("tensi"));
		editor.apply(result);
		expect(result.ok && editor.spanText(result.spanId)).toBe("tension");
	});

	it("refuses a selection that partly overlaps another span", () => {
		const editor = new Editor(essay);
		editor.createSpan("product development");
		const result = createSpanFromSelection(editor.state, editor.select("development comes"));
		expect(result.ok).toBe(false);
	});

	it("typing inside the active version keeps the span and records the edit when switching away", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		const range = spanRange(editor.state, id)!;
		editor.type(range.from + 3, range.from + 3, "XX");
		expect(editor.spanText(id)).toBe("preXXssure");
		editor.apply(cycleSpan(editor.state, id, 1, options));
		editor.apply(cycleSpan(editor.state, id, 1, options));
		expect(editor.spanText(id)).toBe("preXXssure");
	});

	it("deleting the showing version swaps in its neighbour, and undo brings it back", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		editor.addVersion(id, "friction");
		const friction = spanMeta(editor.state, id)!.activeVersion;
		editor.apply(deleteVersionFromSpan(editor.state, id, friction, { ...options, prefer: "next" }));
		expect(editor.spanText(id)).toBe("tension");
		expect(spanMeta(editor.state, id)!.versions).toHaveLength(2);
		editor.undo();
		expect(editor.spanText(id)).toBe("friction");
		expect(spanMeta(editor.state, id)!.versions).toHaveLength(3);
	});

	it("a span reduced to one version stops being a span", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		const pressure = spanMeta(editor.state, id)!.activeVersion;
		editor.apply(deleteVersionFromSpan(editor.state, id, pressure, { ...options, prefer: "previous" }));
		expect(editor.doc).toBe(essay);
		expect(spanMeta(editor.state, id)).toBeUndefined();
		editor.undo();
		expect(editor.spanText(id)).toBe("pressure");
	});

	it("the original cannot be deleted while it is showing", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		editor.apply(cycleSpan(editor.state, id, 1, options));
		const original = spanMeta(editor.state, id)!.versions[0]!.id;
		expect(deleteVersionFromSpan(editor.state, id, original, { ...options, prefer: "next" }).ok).toBe(false);
	});

	it("deleting the span's text removes it, and undo restores it with its versions", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		const range = spanRange(editor.state, id)!;
		editor.type(range.from - 1, range.to, "");
		expect(spanMeta(editor.state, id)).toBeUndefined();
		editor.undo();
		expect(editor.spanText(id)).toBe("pressure");
		expect(spanMeta(editor.state, id)!.versions).toHaveLength(2);
	});

	it("a span survives the file being rewritten from outside", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		const rewritten = `New first line.\n\n${essay}`;
		editor.state = editor.state.update({ changes: { from: 0, to: editor.doc.length, insert: rewritten } }).state;
		expect(editor.spanText(id)).toBe("tension");
	});

	it("settling keeps the showing text and drops the rest", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		editor.apply(settleSpans(editor.state, [id]));
		expect(editor.doc).toContain("the pressure in");
		expect(listSpans(editor.state)).toHaveLength(0);
		editor.undo();
		expect(spanMeta(editor.state, id)!.versions).toHaveLength(2);
	});

	it("AI versions do not change the showing text, and can be removed at once", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		for (const text of ["strain", "friction"]) {
			editor.apply(addVersionToSpan(editor.state, id, text, "ai", { ...options, activate: false, model: "openai/gpt-6-luna" }));
		}
		expect(editor.spanText(id)).toBe("pressure");
		expect(spanMeta(editor.state, id)!.versions.map((version) => version.source)).toEqual(["human", "human", "ai", "ai"]);
		editor.apply(removeAiVersions(editor.state, id, options));
		expect(spanMeta(editor.state, id)!.versions).toHaveLength(2);
	});

	it("duplicate versions are not added twice", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		editor.addVersion(id, "Pressure ");
		expect(spanMeta(editor.state, id)!.versions).toHaveLength(2);
	});
});

describe("selection during swaps", () => {
	it("a cursor inside a span stays inside it, and a selection covers the new text", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		const range = spanRange(editor.state, id)!;
		editor.state = editor.state.update({ selection: { anchor: range.from + 2 } }).state;
		editor.apply(cycleSpan(editor.state, id, 1, options));
		const cursor = editor.state.selection.main;
		expect(cursor.empty && cursor.from === range.from + 2).toBe(true);

		const sentence = editor.createSpan("Much of the tension in product development comes from balance.");
		editor.state = editor.state.update({ selection: { anchor: editor.select("Much of the tension").from, head: editor.select("balance.").to } }).state;
		editor.addVersion(sentence, "A shorter sentence.");
		const selected = editor.state.selection.main;
		expect(selected.from).toBeLessThan(selected.to);
		expect(editor.doc.slice(selected.from, selected.to)).toBe("A shorter sentence.");
	});
});

describe("nesting", () => {
	const doc = "First sentence has a tension word. Second sentence ends here.\n\nNext paragraph.";

	it("switching a paragraph version hides inner spans it lacks and brings them back later", () => {
		const editor = new Editor(doc);
		const word = editor.createSpan("tension");
		editor.addVersion(word, "pressure");
		const paragraph = editor.createSpan("First sentence has a pressure word. Second sentence ends here.");
		expect(spanMeta(editor.state, paragraph)!.unit).toBe("paragraph");

		editor.addVersion(paragraph, "A tighter rewrite. With nothing in common.");
		expect(spanRange(editor.state, word)).toBeNull();
		expect(spanMeta(editor.state, word)!.hiddenIn).toBe(paragraph);

		editor.apply(cycleSpan(editor.state, paragraph, 1, options));
		expect(editor.spanText(word)).toBe("pressure");
		expect(spanMeta(editor.state, word)!.hiddenIn).toBeUndefined();
	});

	it("an inner span whose text exists in the new paragraph version re-attaches there", () => {
		const editor = new Editor(doc);
		const word = editor.createSpan("tension");
		editor.addVersion(word, "pressure");
		const paragraph = editor.createSpan("First sentence has a pressure word. Second sentence ends here.");
		editor.addVersion(paragraph, "Shorter: the pressure word stays. Done.");
		expect(editor.spanText(word)).toBe("pressure");
		expect(editor.doc.startsWith("Shorter: the pressure word")).toBe(true);
	});
});

describe("ghosting", () => {
	it("ghosts, revives, and deletes all ghosted text with tidy spacing", () => {
		const editor = new Editor(essay);
		editor.apply(ghostRange(editor.state, editor.select("in product development ")));
		expect(ghosts.list(editor.state)).toHaveLength(1);
		const revived = editor.apply(reviveRange(editor.state, { from: editor.select("product").from, to: editor.select("product").from }));
		expect(revived.ok).toBe(true);
		expect(ghosts.list(editor.state)).toHaveLength(0);

		editor.apply(ghostRange(editor.state, editor.select("in product development")));
		editor.apply(deleteAllGhosts(editor.state));
		expect(editor.doc).toBe("Much of the tension comes from balance. It is like a thumbtack, for example.");
		editor.undo();
		expect(editor.doc).toBe(essay);
		expect(ghosts.list(editor.state)).toHaveLength(1);
	});

	it("ghosting next to an existing ghost merges them", () => {
		const editor = new Editor(essay);
		editor.apply(ghostRange(editor.state, editor.select("in product")));
		editor.apply(ghostRange(editor.state, editor.select("development")));
		const all = ghosts.list(editor.state);
		expect(all).toHaveLength(1);
		expect(editor.doc.slice(all[0]!.range.from, all[0]!.range.to)).toBe("in product development");
	});

	it("editing inside a ghost keeps it ghosted", () => {
		const editor = new Editor(essay);
		editor.apply(ghostRange(editor.state, editor.select("in product development")));
		editor.type(editor.select("product").from + 3, editor.select("product").from + 3, "Z");
		const [ghost] = ghosts.list(editor.state);
		expect(editor.doc.slice(ghost!.range.from, ghost!.range.to)).toBe("in proZduct development");
	});
});

describe("overflow", () => {
	it("stashing removes the text and adds a block; undo restores both", () => {
		const editor = new Editor(`${essay}\n\nA paragraph I might cut.\n\nThe end.`);
		editor.apply(stashRange(editor.state, editor.select("A paragraph I might cut.")));
		expect(editor.doc).toBe(`${essay}\n\nThe end.`);
		expect(editor.state.field(overflowField).map((block) => block.text)).toEqual(["A paragraph I might cut."]);
		editor.undo();
		expect(editor.doc).toContain("A paragraph I might cut.");
		expect(editor.state.field(overflowField)).toHaveLength(0);
	});

	it("inserting a block puts it at the position and empties Overflow unless a copy is kept", () => {
		const editor = new Editor("One two three.");
		editor.apply(stashRange(editor.state, editor.select("two")));
		expect(editor.doc).toBe("One three.");
		const [block] = editor.state.field(overflowField);
		editor.apply(insertOverflowBlock(editor.state, block!.id, editor.doc.length - 1, true));
		expect(editor.doc).toBe("One three two.");
		expect(editor.state.field(overflowField)).toHaveLength(1);
		editor.apply(insertOverflowBlock(editor.state, block!.id, 3, false));
		expect(editor.doc).toBe("One two three two.");
		expect(editor.state.field(overflowField)).toHaveLength(0);
	});
});

describe("switching directly", () => {
	it("switchToVersion picks any version by id", () => {
		const editor = new Editor(essay);
		const id = editor.createSpan("tension");
		editor.addVersion(id, "pressure");
		editor.addVersion(id, "friction");
		const pressure = spanMeta(editor.state, id)!.versions[1]!;
		editor.apply(switchToVersion(editor.state, id, pressure, options));
		expect(editor.spanText(id)).toBe("pressure");
	});
});
