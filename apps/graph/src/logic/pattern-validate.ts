/**
 * Pure validation for `GraphPattern` shape. Independent of the SQL compiler
 * (Stage 9.13.3) — this catches structural problems in the pattern as the
 * user builds it in the UI, before the compiler is asked to do anything.
 *
 * The full pattern compiler is the entities service's job; this is the
 * client-side guard so the renderer can disable "Apply" on an invalid
 * pattern without round-tripping through IPC.
 */

import {
	type EdgeConstraint,
	type GraphPattern,
	PATTERN_MAX_EDGES,
	PATTERN_MAX_HOPS,
	PATTERN_MAX_SUBJECTS,
	type Subject,
} from "../types/pattern";

export type PatternIssue =
	| { code: "no-subjects" }
	| { code: "too-many-subjects"; count: number; max: number }
	| { code: "too-many-edges"; count: number; max: number }
	| { code: "unknown-subject"; subjectName: string; edgeIndex: number; side: "from" | "to" }
	| { code: "subject-empty-types"; subjectName: string }
	| { code: "edge-empty-link-types"; edgeIndex: number }
	| { code: "hops-out-of-range"; edgeIndex: number; min: number; max: number }
	| { code: "hops-inverted"; edgeIndex: number; min: number; max: number }
	| { code: "primary-subject-missing"; primarySubject: string }
	| { code: "forbidden-edge-on-multi-hop"; edgeIndex: number };

export type ValidatePatternResult = { ok: true } | { ok: false; issues: PatternIssue[] };

export function validatePattern(pattern: GraphPattern): ValidatePatternResult {
	const issues: PatternIssue[] = [];
	const subjectNames = Object.keys(pattern.subjects);

	if (subjectNames.length === 0) {
		issues.push({ code: "no-subjects" });
	}
	if (subjectNames.length > PATTERN_MAX_SUBJECTS) {
		issues.push({
			code: "too-many-subjects",
			count: subjectNames.length,
			max: PATTERN_MAX_SUBJECTS,
		});
	}
	if (pattern.edges.length > PATTERN_MAX_EDGES) {
		issues.push({
			code: "too-many-edges",
			count: pattern.edges.length,
			max: PATTERN_MAX_EDGES,
		});
	}

	if (!subjectNames.includes(pattern.primarySubject) && subjectNames.length > 0) {
		issues.push({ code: "primary-subject-missing", primarySubject: pattern.primarySubject });
	}

	for (const [name, subject] of Object.entries(pattern.subjects)) {
		if (hasNoTypeFilter(subject)) {
			issues.push({ code: "subject-empty-types", subjectName: name });
		}
	}

	pattern.edges.forEach((edge, idx) => {
		validateEdge(edge, idx, subjectNames, issues);
	});

	if (issues.length > 0) return { ok: false, issues };
	return { ok: true };
}

function hasNoTypeFilter(subject: Subject): boolean {
	return subject.types.length === 0;
}

function validateEdge(
	edge: EdgeConstraint,
	idx: number,
	subjectNames: string[],
	issues: PatternIssue[],
): void {
	if (!subjectNames.includes(edge.from)) {
		issues.push({
			code: "unknown-subject",
			subjectName: edge.from,
			edgeIndex: idx,
			side: "from",
		});
	}
	if (!subjectNames.includes(edge.to)) {
		issues.push({
			code: "unknown-subject",
			subjectName: edge.to,
			edgeIndex: idx,
			side: "to",
		});
	}
	if (edge.linkTypes.length === 0) {
		issues.push({ code: "edge-empty-link-types", edgeIndex: idx });
	}
	const [minHops, maxHops] = edge.hops;
	if (minHops < 0 || maxHops > PATTERN_MAX_HOPS) {
		issues.push({ code: "hops-out-of-range", edgeIndex: idx, min: minHops, max: maxHops });
	}
	if (minHops > maxHops) {
		issues.push({ code: "hops-inverted", edgeIndex: idx, min: minHops, max: maxHops });
	}
	if (edge.match === "forbidden" && maxHops > 1) {
		issues.push({ code: "forbidden-edge-on-multi-hop", edgeIndex: idx });
	}
}
