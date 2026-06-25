/**
 * Schema-version comparison + forward-only migration runner.
 *
 * Used in two places (per docs/implementation-plan.md Stage 0.7 + 0.8, then
 * reused in Stage 3 for SQLite migrations):
 *
 *   1. Vault format check on open — `vault.json.format` is compared against
 *      the shell's `SUPPORTED_VAULT_FORMAT`. Newer formats refuse to open.
 *
 *   2. SQLite `_schema_version` migrations — each domain DB declares a list of
 *      ordered migrations; `runMigrations` applies the ones above the stored
 *      version.
 *
 * The format is `<major>.<minor>` for vault.json (per docs/foundations/28-vault-and-onboarding.md);
 * SQLite migrations use a monotonic integer. Both are handled here.
 */

export type DottedVersion = `${number}.${number}` | `${number}.${number}.${number}`;

export type CompareResult = -1 | 0 | 1;

export function compareDottedVersions(a: string, b: string): CompareResult {
	const left = parseDotted(a);
	const right = parseDotted(b);
	const length = Math.max(left.length, right.length);
	for (let i = 0; i < length; i++) {
		const l = left[i] ?? 0;
		const r = right[i] ?? 0;
		if (l < r) return -1;
		if (l > r) return 1;
	}
	return 0;
}

function parseDotted(input: string): number[] {
	if (typeof input !== "string" || input.length === 0) {
		throw new Error(`Invalid version string: ${JSON.stringify(input)}`);
	}
	const parts = input.split(".");
	const numbers: number[] = [];
	for (const part of parts) {
		const n = Number(part);
		if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
			throw new Error(`Invalid version component in ${input}: ${part}`);
		}
		numbers.push(n);
	}
	return numbers;
}

export class VaultFormatTooNew extends Error {
	readonly vaultFormat: string;
	readonly supportedFormat: string;
	constructor(vaultFormat: string, supportedFormat: string) {
		super(
			`Vault format ${vaultFormat} is newer than this shell supports (max ${supportedFormat}). Update Brainstorm to open this vault.`,
		);
		this.name = "VaultFormatTooNew";
		this.vaultFormat = vaultFormat;
		this.supportedFormat = supportedFormat;
	}
}

/**
 * Thrown when a vault.json's `format` field is strictly less than the v1.0
 * freeze. Pre-freeze vaults predate the migration scaffold (10.8); there is
 * no migration table that can carry them forward without ambiguity, so we
 * fail-loud rather than guess. The shell still exposes an undocumented
 * test-only env safety valve (`BRAINSTORM_ALLOW_PRE_FREEZE_VAULTS=1`) that
 * downgrades the throw to a `console.warn` — see OQ-215.
 */
export class VaultFormatPreFreezeError extends Error {
	readonly vaultFormat: string;
	readonly minimumFormat: string;
	constructor(vaultFormat: string, minimumFormat: string) {
		super(
			`Vault format ${vaultFormat} predates the ${minimumFormat} freeze (Stage 10.8). This shell refuses to open pre-freeze vaults — there is no migration path. Recreate the vault from a backup, or set BRAINSTORM_ALLOW_PRE_FREEZE_VAULTS=1 (test-only) to override.`,
		);
		this.name = "VaultFormatPreFreezeError";
		this.vaultFormat = vaultFormat;
		this.minimumFormat = minimumFormat;
	}
}

/**
 * Throws `VaultFormatTooNew` when the vault's **major** version is strictly
 * greater than the shell's `supportedFormat` major. Same-major future-minor
 * vaults (e.g. supported=`1.0`, vault=`1.5`) open via preserve-and-ignore:
 * the parsed `vault.json` retains its unknown future-minor fields verbatim,
 * the shell ignores what it doesn't understand, and the next write
 * (atomic + key-preserving) keeps the forward-compat keys intact. The
 * major-version axis is reserved for wire-incompatible changes.
 *
 * Older vaults are migrated by the migration runner; never refused.
 */
export function assertVaultFormatSupported(vaultFormat: string, supportedFormat: string): void {
	const vaultMajor = majorOf(vaultFormat);
	const supportedMajor = majorOf(supportedFormat);
	if (vaultMajor > supportedMajor) {
		throw new VaultFormatTooNew(vaultFormat, supportedFormat);
	}
}

function majorOf(version: string): number {
	const parts = parseDotted(version);
	return parts[0] ?? 0;
}

/**
 * Throws `VaultFormatPreFreezeError` if the vault's format is strictly less
 * than the v1.0 freeze. The env var `BRAINSTORM_ALLOW_PRE_FREEZE_VAULTS=1`
 * (test-only, undocumented per OQ-215) downgrades the throw to a one-line
 * `console.warn` so QA branches with long-lived pre-freeze test vaults stay
 * openable.
 */
export function assertVaultFormatNotPreFreeze(vaultFormat: string, minimumFormat: string): void {
	if (compareDottedVersions(vaultFormat, minimumFormat) >= 0) return;
	if (process.env.BRAINSTORM_ALLOW_PRE_FREEZE_VAULTS === "1") {
		console.warn(
			`[brainstorm] vault format ${vaultFormat} predates the ${minimumFormat} freeze; BRAINSTORM_ALLOW_PRE_FREEZE_VAULTS=1 — opening anyway`,
		);
		return;
	}
	throw new VaultFormatPreFreezeError(vaultFormat, minimumFormat);
}

export type Migration<Context> = {
	/** Strictly increasing; gaps are allowed but order must match. */
	version: number;
	description: string;
	up: (ctx: Context) => Promise<void> | void;
};

export type MigrationLogEntry = {
	version: number;
	description: string;
	appliedAt: number;
};

export type MigrationResult = {
	from: number;
	to: number;
	applied: MigrationLogEntry[];
};

/**
 * Apply each migration whose `version` is strictly greater than `current`.
 * Migrations run in declared order. Returns the new version and a log of
 * applied migrations (one entry per migration).
 *
 * Errors during a migration propagate. The caller decides whether to roll
 * back the side effects (e.g. SQLite transaction).
 */
export async function runMigrations<Context>(
	current: number,
	target: number,
	migrations: readonly Migration<Context>[],
	ctx: Context,
): Promise<MigrationResult> {
	if (!Number.isInteger(current) || current < 0) {
		throw new Error(`Invalid current version: ${current}`);
	}
	if (!Number.isInteger(target) || target < 0) {
		throw new Error(`Invalid target version: ${target}`);
	}
	if (target < current) {
		throw new Error(
			`Refusing to migrate downward (current=${current}, target=${target}). Migrations are forward-only.`,
		);
	}
	assertOrdered(migrations);
	const applied: MigrationLogEntry[] = [];
	let version = current;
	for (const migration of migrations) {
		if (migration.version <= current) continue;
		if (migration.version > target) break;
		await migration.up(ctx);
		applied.push({
			version: migration.version,
			description: migration.description,
			appliedAt: Date.now(),
		});
		version = migration.version;
	}
	return { from: current, to: version, applied };
}

function assertOrdered(migrations: readonly { version: number }[]): void {
	let previous = -1;
	for (const m of migrations) {
		if (!Number.isInteger(m.version) || m.version < 0) {
			throw new Error(`Migration has invalid version: ${JSON.stringify(m.version)}`);
		}
		if (m.version <= previous) {
			throw new Error(`Migrations must be strictly increasing; saw ${m.version} after ${previous}.`);
		}
		previous = m.version;
	}
}
