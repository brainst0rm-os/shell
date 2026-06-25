/**
 * Promote the free-text `Person.company` string to a real `Company/v1`
 * entity reference.
 *
 * Before: `company` was a plain string, so two people at the same employer
 * were only ever connected by an *inferred shared-attribute* edge ("these
 * two share a company value") — invisible and easily mistaken for a real
 * relationship. After: each distinct company name becomes one `Company/v1`
 * entity and every person's `company` points at it, so the catalog-driven
 * property-reference derivation draws an honest `Person → Company` edge and
 * the people cluster around a single shared hub node.
 *
 * This module is the **pure planner**: given the person rows, it computes
 * which Company entities to create and how to rewrite each person's
 * `company` value. The `entities.db` migration applies the plan; keeping the
 * decision logic here makes it unit-testable without a database.
 */

export const COMPANY_TYPE = "brainstorm/Company/v1";

/** Minimal person row the planner reads. `company` is whatever the JSON
 *  column held — a name string (to convert), an already-migrated id, or
 *  anything else (ignored). */
export type PersonCompanyRow = {
	id: string;
	company: unknown;
	updatedAt: number;
};

export type CompanyToCreate = {
	id: string;
	name: string;
};

export type PersonCompanyUpdate = {
	personId: string;
	companyId: string;
};

export type CompanyMigrationPlan = {
	companies: CompanyToCreate[];
	updates: PersonCompanyUpdate[];
};

/** Deterministic `Company/v1` id from a company name. Stable across runs so
 *  the migration is idempotent and seed data can reference the same id. */
export function companyIdForName(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return `company_${slug.length > 0 ? slug : "unnamed"}`;
}

/**
 * Plan the migration from a set of person rows + the ids of `Company/v1`
 * entities that already exist. Only rows whose `company` is a non-empty
 * string that is NOT already a known company id are converted (idempotent:
 * a re-run, or a row already pointing at a company, is left alone).
 */
export function planCompanyMigration(
	persons: ReadonlyArray<PersonCompanyRow>,
	existingCompanyIds: ReadonlySet<string>,
): CompanyMigrationPlan {
	const companies = new Map<string, CompanyToCreate>();
	const updates: PersonCompanyUpdate[] = [];

	for (const person of persons) {
		const value = person.company;
		if (typeof value !== "string") continue;
		const name = value.trim();
		if (name.length === 0) continue;
		// Value already points at an existing Company entity → migrated.
		if (existingCompanyIds.has(value)) continue;
		const id = companyIdForName(name);
		// Defensive: value already equals its own computed id → treat as done.
		if (value === id) continue;
		if (!existingCompanyIds.has(id) && !companies.has(id)) {
			companies.set(id, { id, name });
		}
		updates.push({ personId: person.id, companyId: id });
	}

	return { companies: [...companies.values()], updates };
}
