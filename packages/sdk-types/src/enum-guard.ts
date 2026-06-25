/**
 * `enumGuard` — the one runtime type-guard factory for "is this value a
 * member of this string enum / frozen string table?".
 *
 * Before this, the exact body
 *   `typeof x === "string" && (TABLE as readonly string[]).includes(x)`
 * was hand-copied a dozen times across `layout.ts`, `typography.ts`,
 * `icon-pack.ts`, and `self-hosting.ts` — well past the project's
 * "three is a hard ceiling, extract before you copy" DRY rule. Every
 * `isLayoutMode` / `isFontRole` / `isIconPackStyle` / `isIterationStatus`
 * etc. is now `enumGuard(THE_TABLE)`: one implementation, identical
 * behaviour, identical public signature, zero consumer churn.
 *
 * Leaf module (no imports) so the contract leaves (`layout` / etc.) can
 * depend on it without introducing an `index`-barrel cycle.
 */

/**
 * Build a type guard for the string-union `T` from its runtime value
 * table. The returned predicate is `true` iff `x` is a string present
 * in `values` (non-strings — incl. `null` / `undefined` / numbers —
 * are always `false`), and narrows `x` to `T`.
 */
export function enumGuard<T extends string>(values: readonly T[]): (x: unknown) => x is T {
	const set = new Set<string>(values);
	return (x: unknown): x is T => typeof x === "string" && set.has(x);
}
