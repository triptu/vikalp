import { useEffect, useRef, useState } from "preact/hooks";
import type { StoreApi } from "zustand/vanilla";

function shallowEqual<T>(a: T, b: T): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	return keysA.every((key) => Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** Subscribes a component to a slice of a zustand store. Re-renders only when the slice changes (shallowly). */
export function useStoreSlice<State, Slice>(store: StoreApi<State>, select: (state: State) => Slice): Slice {
	const selectRef = useRef(select);
	selectRef.current = select;
	const [slice, setSlice] = useState(() => select(store.getState()));
	const sliceRef = useRef(slice);
	sliceRef.current = slice;

	useEffect(() => {
		const check = () => {
			const next = selectRef.current(store.getState());
			if (!shallowEqual(next, sliceRef.current)) {
				sliceRef.current = next;
				setSlice(() => next);
			}
		};
		check();
		return store.subscribe(check);
	}, [store]);

	return slice;
}
