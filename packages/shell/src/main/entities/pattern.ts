/**
 * Pattern shape — canonical types for the entities service's pattern query
 * surface. The Graph app's `apps/graph/src/types/pattern.ts` mirrors this
 * shape; the SDK-types surface will re-export from here once the entities
 * service ships (Stage 9.3).
 *
 * For the design rationale see docs/apps/graph/10-pattern-filters.md.
 *
 * Defining the surface here (rather than in `apps/graph/`) keeps the
 * compiler shell-side. The Graph app's renderer never compiles SQL —
 * it calls `entities.subscribe({graphPattern})` and the entities service
 * (which owns this compiler) does the SQL work.
 */

export type PropertyPath = string;

export type ScalarValue = string | number | boolean | null;

export type PropertyPredicate =
	| { $eq: Record<PropertyPath, ScalarValue> }
	| { $neq: Record<PropertyPath, ScalarValue> }
	| { $contains: Record<PropertyPath, ScalarValue> }
	| { $notContains: Record<PropertyPath, ScalarValue> }
	| { $gt: Record<PropertyPath, number | string> }
	| { $lt: Record<PropertyPath, number | string> }
	| { $gte: Record<PropertyPath, number | string> }
	| { $lte: Record<PropertyPath, number | string> }
	| { $in: Record<PropertyPath, ScalarValue[]> }
	| { $notIn: Record<PropertyPath, ScalarValue[]> }
	| { $exists: Record<PropertyPath, true> }
	| { $empty: Record<PropertyPath, true> }
	| { $like: Record<PropertyPath, string> }
	| { $notLike: Record<PropertyPath, string> }
	| { $and: PropertyPredicate[] }
	| { $or: PropertyPredicate[] }
	| { $not: PropertyPredicate };

export enum SubjectKind {
	Entity = "entity",
}

export type Subject = {
	kind: SubjectKind.Entity;
	types: string[];
	where: PropertyPredicate | null;
	displayName: string;
};

export enum EdgeMatch {
	Required = "required",
	Optional = "optional",
	Forbidden = "forbidden",
}

export enum EdgeDirection {
	Out = "out",
	In = "in",
	Both = "both",
}

export type EdgeConstraint = {
	from: string;
	to: string;
	linkTypes: string[];
	direction: EdgeDirection;
	match: EdgeMatch;
	/** [min, max] hops; multi-hop (max > 1) lands in 9.13.4. */
	hops: readonly [min: number, max: number];
};

export type GraphPattern = {
	subjects: Record<string, Subject>;
	edges: EdgeConstraint[];
	primarySubject: string;
};

/** Per-pattern hard caps per docs/apps/graph/01-data-model.md §Hard caps. */
export const PATTERN_MAX_SUBJECTS = 16;
export const PATTERN_MAX_EDGES = 32;
export const PATTERN_MAX_HOPS = 6;
