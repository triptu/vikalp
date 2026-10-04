import type { NoteFile } from "../core/model/types";
import { migrateNoteFile } from "./migrations";

/** The slice of Obsidian's DataAdapter the repository uses. */
export interface FileAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	stat(path: string): Promise<{ mtime: number } | null>;
	rename(from: string, to: string): Promise<void>;
}

const TRASH_DAYS = 30;

/**
 * Reads and writes one JSON file per note in the plugin folder. The note's
 * markdown never changes; deleting a sidecar leaves a normal note.
 */
export class SidecarRepository {
	private readonly notesDir: string;
	private readonly trashDir: string;
	private readonly lastWritten = new Map<string, string>();

	constructor(
		private readonly adapter: FileAdapter,
		pluginDir: string,
		private readonly onCorrupt: (notePath: string, backupPath: string) => void = () => {},
	) {
		this.notesDir = `${pluginDir}/notes`;
		this.trashDir = `${pluginDir}/trash`;
	}

	/**
	 * Reads a note's sidecar. A sidecar that can't be parsed is kept aside as
	 * `.corrupt-<time>.json` (never overwritten) and the note loads empty.
	 */
	async load(notePath: string): Promise<NoteFile | null> {
		const file = await this.fileFor(notePath);
		const tempFile = `${file}.tmp`;
		if (!(await this.adapter.exists(file))) {
			if (!(await this.adapter.exists(tempFile))) return null;
			await this.adapter.rename(tempFile, file);
		}
		const raw = await this.adapter.read(file);
		try {
			const note = migrateNoteFile(JSON.parse(raw), notePath);
			this.lastWritten.set(file, raw);
			return note;
		} catch (error) {
			console.warn(`Vikalp: could not parse ${file}`, error);
			const backup = `${file.replace(/\.json$/, "")}.corrupt-${Date.now()}.json`;
			await this.adapter.write(backup, raw);
			await this.adapter.remove(file);
			this.onCorrupt(notePath, backup);
			return null;
		}
	}

	/** Writes the sidecar, or removes it when the note has nothing worth keeping. */
	async save(notePath: string, note: NoteFile, isEmpty: boolean): Promise<void> {
		const file = await this.fileFor(notePath);
		if (isEmpty) {
			if (await this.adapter.exists(file)) await this.adapter.remove(file);
			this.lastWritten.delete(file);
			return;
		}
		const json = JSON.stringify(note, null, "\t");
		if (this.lastWritten.get(file) === json) return;
		await this.ensureDir(this.notesDir);
		const tempFile = `${file}.tmp`;
		await this.adapter.write(tempFile, json);
		if (await this.adapter.exists(file)) await this.adapter.remove(file);
		await this.adapter.rename(tempFile, file);
		this.lastWritten.set(file, json);
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		const note = await this.load(oldPath);
		if (!note) return;
		await this.save(newPath, { ...note, path: newPath }, false);
		const oldFile = await this.fileFor(oldPath);
		if (await this.adapter.exists(oldFile)) await this.adapter.remove(oldFile);
		this.lastWritten.delete(oldFile);
	}

	/** Moves a deleted note's sidecar to the trash folder, kept for 30 days. */
	async archive(notePath: string): Promise<void> {
		const note = await this.load(notePath);
		if (!note) return;
		await this.ensureDir(this.trashDir);
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		await this.adapter.write(`${this.trashDir}/${stamp}-${await hashPath(notePath)}.json`, JSON.stringify(note, null, "\t"));
		const file = await this.fileFor(notePath);
		await this.adapter.remove(file);
		this.lastWritten.delete(file);
	}

	async emptyOldTrash(now = Date.now()): Promise<void> {
		if (!(await this.adapter.exists(this.trashDir))) return;
		const { files } = await this.adapter.list(this.trashDir);
		for (const file of files) {
			const stat = await this.adapter.stat(file);
			if (stat && now - stat.mtime > TRASH_DAYS * 86_400_000) await this.adapter.remove(file);
		}
	}

	private async fileFor(notePath: string): Promise<string> {
		return `${this.notesDir}/${await hashPath(notePath)}.json`;
	}

	private async ensureDir(dir: string) {
		if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
	}
}

export async function hashPath(notePath: string): Promise<string> {
	const normalized = notePath.replace(/\\/g, "/").replace(/^\/+/, "").normalize("NFC");
	const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(normalized));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
