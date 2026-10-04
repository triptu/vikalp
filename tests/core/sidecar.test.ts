import { describe, expect, it } from "vitest";
import { SidecarRepository, type FileAdapter } from "../../src/persistence/sidecar";
import { emptyNoteFile } from "../../src/core/model/types";

function memoryAdapter(): FileAdapter & { files: Map<string, string> } {
	const files = new Map<string, string>();
	return {
		files,
		exists: async (path) => files.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`)),
		read: async (path) => files.get(path) ?? "",
		write: async (path, data) => void files.set(path, data),
		remove: async (path) => void files.delete(path),
		mkdir: async () => {},
		list: async (path) => ({ files: [...files.keys()].filter((key) => key.startsWith(`${path}/`)), folders: [] }),
		stat: async () => ({ mtime: Date.now() }),
		rename: async (from, to) => {
			files.set(to, files.get(from) ?? "");
			files.delete(from);
		},
	};
}

describe("sidecar files", () => {
	it("saves and loads a note, and survives a rename", async () => {
		const adapter = memoryAdapter();
		const repository = new SidecarRepository(adapter, "plugin");
		const note = { ...emptyNoteFile("a.md", true), overflow: [{ id: "ov_1", text: "kept", createdAt: 1 }] };
		await repository.save("a.md", note, false);
		expect((await repository.load("a.md"))?.overflow[0]?.text).toBe("kept");
		await repository.rename("a.md", "b.md");
		expect(await repository.load("a.md")).toBeNull();
		expect((await repository.load("b.md"))?.path).toBe("b.md");
	});

	it("keeps a corrupt sidecar aside instead of overwriting it", async () => {
		const adapter = memoryAdapter();
		const reported: string[] = [];
		const repository = new SidecarRepository(adapter, "plugin", (path) => reported.push(path));
		await repository.save("a.md", emptyNoteFile("a.md", true), false);
		const [file] = [...adapter.files.keys()];
		adapter.files.set(file!, '{"schema": 1, "spans": [');
		expect(await repository.load("a.md")).toBeNull();
		expect(reported).toEqual(["a.md"]);
		expect([...adapter.files.values()]).toContain('{"schema": 1, "spans": [');
	});

	it("an empty note leaves no sidecar behind", async () => {
		const adapter = memoryAdapter();
		const repository = new SidecarRepository(adapter, "plugin");
		await repository.save("a.md", emptyNoteFile("a.md", true), false);
		await repository.save("a.md", emptyNoteFile("a.md", false), true);
		expect(adapter.files.size).toBe(0);
	});
});
