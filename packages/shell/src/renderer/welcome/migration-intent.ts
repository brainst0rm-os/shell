/**
 * One-shot "open Backup & Migration on arrival" request (IE-3).
 *
 * The first-launch "Migrating from…" entry lives on the Welcome screen, but the
 * import wizard lives in Settings → Backup & Migration, which only exists once a
 * vault is open. Welcome and Dashboard are mounted exclusively (app.tsx switches
 * on the active vault), so this module-level flag carries the intent across that
 * unmount: Welcome sets it right before it creates the migration-target vault,
 * and the freshly-mounted Dashboard consumes it exactly once to auto-open the
 * panel. It is deliberately set ONLY on a successful migrate-create — never on
 * merely entering the create form — so backing out can't leave a stale flag that
 * later hijacks an unrelated vault open.
 */

let pending = false;

/** Record that the next dashboard mount should open Backup & Migration. */
export function requestMigrationImport(): void {
	pending = true;
}

/** Read and clear the request. Returns true at most once per set. */
export function consumeMigrationImport(): boolean {
	const was = pending;
	pending = false;
	return was;
}
