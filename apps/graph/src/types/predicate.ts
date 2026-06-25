/**
 * Property-predicate language used by Subject.where (per
 * ) — mirrors the shape from
 *  so the predicate UI is shared.
 *
 * Defined locally so the type-level surface is self-contained; the runtime
 * compiler lives in the entities service (Stage 9.3) and the visual builder
 * is the Database app's shared predicate component (DRY rule —
 * ).
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
	| { $allIn: Record<PropertyPath, ScalarValue[]> }
	| { $notIn: Record<PropertyPath, ScalarValue[]> }
	| { $exists: Record<PropertyPath, true> }
	| { $empty: Record<PropertyPath, true> }
	| { $like: Record<PropertyPath, string> }
	| { $notLike: Record<PropertyPath, string> }
	| { $and: PropertyPredicate[] }
	| { $or: PropertyPredicate[] }
	| { $not: PropertyPredicate };

export enum FilterNodeKind {
	Predicate = "predicate",
	Group = "group",
}

export enum FilterGroupOp {
	And = "and",
	Or = "or",
}

export type FilterPredicateNode = {
	kind: FilterNodeKind.Predicate;
	predicate: PropertyPredicate;
};

export type FilterGroupNode = {
	kind: FilterNodeKind.Group;
	op: FilterGroupOp;
	children: FilterNode[];
};

export type FilterNode = FilterPredicateNode | FilterGroupNode;
