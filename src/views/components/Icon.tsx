import { createContext } from "preact";
import { useContext, useLayoutEffect, useRef } from "preact/hooks";

/** Renders an icon by name into an element. The plugin provides Obsidian's `setIcon`. */
export type IconRenderer = (element: HTMLElement, name: string) => void;

export const IconContext = createContext<IconRenderer>(() => {});

export function Icon({ name, className }: { name: string; className?: string }) {
	const render = useContext(IconContext);
	const ref = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		if (!ref.current) return;
		ref.current.replaceChildren();
		render(ref.current, name);
	}, [name, render]);
	return <span ref={ref} className={`vk-icon ${className ?? ""}`} aria-hidden="true" />;
}
