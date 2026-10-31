import { useEffect, useRef } from "preact/hooks";
import { Icon } from "./Icon";

export interface ActionMenuItem {
	key: string;
	label: string;
	icon: string;
	/** The command's own hotkey, which works without opening this menu. */
	hotkey?: string;
	/** Why the action can't run here, shown instead of running it. */
	unavailable?: string;
	run: () => void;
}

export interface ActionMenuProps {
	items: ActionMenuItem[];
	onClose: () => void;
}

/** A small menu of Vikalp actions, each one letter away. */
export function ActionMenu({ items, onClose }: ActionMenuProps) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => ref.current?.focus(), []);

	const choose = (item: ActionMenuItem) => {
		if (item.unavailable) return;
		onClose();
		item.run();
	};

	return (
		<div
			ref={ref}
			className="vk-action-menu"
			role="menu"
			aria-label="Vikalp actions"
			tabIndex={-1}
			onKeyDown={(event) => {
				if (event.metaKey || event.ctrlKey || event.altKey) return;
				const item = items.find((candidate) => candidate.key.toLowerCase() === event.key.toLowerCase());
				if (event.key === "Escape") {
					event.preventDefault();
					onClose();
				} else if (item) {
					event.preventDefault();
					choose(item);
				}
			}}
		>
			{items.map((item) => (
				<button
					key={item.key}
					role="menuitem"
					className={`vk-action-item${item.unavailable ? " is-unavailable" : ""}`}
					title={item.unavailable}
					onClick={() => choose(item)}
				>
					<Icon name={item.icon} className="vk-action-icon" />
					<span className="vk-action-label">{item.label}</span>
					{item.hotkey && <span className="vk-action-hotkey">{item.hotkey}</span>}
					<kbd className="vk-action-key">{item.key}</kbd>
				</button>
			))}
		</div>
	);
}
