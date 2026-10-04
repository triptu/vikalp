const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

/** Short random id with a readable prefix, e.g. `sp_8f2k9q`. */
export function newId(prefix: string): string {
	let suffix = "";
	for (let index = 0; index < 8; index++) suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	return `${prefix}_${suffix}`;
}
