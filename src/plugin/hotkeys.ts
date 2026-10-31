import { Platform, type App } from "obsidian";

/** The hotkey a Vikalp command has now, as Obsidian prints it (⌘J, Ctrl+J), or null when it has none. */
export function hotkeyFor(app: App, commandId: string): string | null {
	// Obsidian has no public API for a command's current hotkey, so this reads the internal one when it exists.
	const manager = (app as unknown as { hotkeyManager?: { printHotkeyForCommand?: (id: string) => string } }).hotkeyManager;
	const printed = manager?.printHotkeyForCommand?.(`vikalp:${commandId}`).replace(/\s+/g, "");
	if (!printed) return null;
	return Platform.isMacOS ? printed.replace(/Enter$/, "↵") : printed;
}

/** A menu item title with the command's hotkey at its right edge, so menus teach the keys. */
export function menuTitle(app: App, title: string, commandId: string): string | DocumentFragment {
	const hotkey = hotkeyFor(app, commandId);
	if (!hotkey) return title;
	const fragment = createFragment();
	fragment.createSpan({ text: title });
	fragment.createEl("kbd", { cls: "vk-menu-key", text: hotkey });
	return fragment;
}
