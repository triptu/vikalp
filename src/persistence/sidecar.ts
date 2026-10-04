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
	) {
		this.notesDir = `${pluginDir}/notes`;
		this.trashDir = `${pluginDir}/trash`;
	}

	async load(notePath: string): Promise<NoteFile | null> {
		const file = await this.fileFor(notePath);
		if (!(await this.adapter.exists(file))) return null;
		try {
			const raw = await this.adapter.read(file);
			this.lastWritten.set(file, raw);
			return migrateNoteFile(JSON.parse(raw), notePath);
		} catch (error) {
			console.warn(`Vikalp: could not read ${file}`, error);
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
		await this.adapter.write(file, json);
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
