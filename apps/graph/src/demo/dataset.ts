/**
 * Demo dataset exercising the canonical example from
 * docs/apps/graph/10-pattern-filters.md (Persons sharing a Berlin school).
 *
 * Used by the scaffold renderer until the entities service lands
 * (Stage 9.3) — this is the "ship a plain-DOM minimum rather than wait
 * for an upcoming dep" instance for Stage 9.13 per the
 * [[avoid-blocking-on-deps]] memory.
 *
 * Timestamps span ~14 days in early 2025 so the history scrubber feels
 * responsive at the spec'd "1 day per second" base rate — full playback
 * is ~14s at 1×, <1s at 16×. The relative ordering still tells the
 * intended story (Schools → first Cities → first Person cohort → second
 * cohort → Notes), just compressed.
 */

import type { InMemoryGraph } from "../logic/in-memory-graph";

const D = (iso: string): number => new Date(iso).getTime();

export const PERSON = "io.example/Person/v1";
export const SCHOOL = "io.example/School/v1";
export const CITY = "io.example/City/v1";
export const NOTE = "io.example/Note/v1";

export const STUDIED_AT = "io.example/StudiedAt/v1";
export const LIVES_IN = "io.example/LivesIn/v1";
export const ABOUT = "io.example/About/v1";

export const DEMO_GRAPH: InMemoryGraph = {
	entities: [
		// Cities first — Berlin is the earliest event so playback opens with it.
		{
			id: "ent_city_berlin",
			type: CITY,
			properties: {
				name: "Berlin",
				country: "Germany",
				icon: { kind: "emoji", value: "🏙️" },
			},
			createdAt: D("2025-01-01"),
			updatedAt: D("2025-01-01"),
			deletedAt: null,
		},
		// Schools
		{
			id: "ent_school_rwth",
			type: SCHOOL,
			properties: {
				name: "RWTH Aachen",
				icon: { kind: "pack", value: "phosphor/graduation-cap" },
			},
			createdAt: D("2025-01-02"),
			updatedAt: D("2025-01-02"),
			deletedAt: null,
		},
		{
			id: "ent_school_eth",
			type: SCHOOL,
			properties: {
				name: "ETH Zürich",
				icon: { kind: "pack", value: "phosphor/graduation-cap" },
			},
			createdAt: D("2025-01-04"),
			updatedAt: D("2025-01-04"),
			deletedAt: null,
		},
		{
			id: "ent_school_mit",
			type: SCHOOL,
			properties: {
				name: "MIT",
				icon: { kind: "pack", value: "phosphor/graduation-cap" },
			},
			createdAt: D("2025-01-05"),
			updatedAt: D("2025-01-05"),
			deletedAt: null,
		},
		// Remaining cities.
		{
			id: "ent_city_munich",
			type: CITY,
			properties: {
				name: "Munich",
				country: "Germany",
				icon: { kind: "pack", value: "phosphor/buildings" },
			},
			createdAt: D("2025-01-06"),
			updatedAt: D("2025-01-06"),
			deletedAt: null,
		},
		{
			id: "ent_city_boston",
			type: CITY,
			properties: {
				name: "Boston",
				country: "USA",
				icon: { kind: "pack", value: "phosphor/buildings" },
			},
			createdAt: D("2025-01-07"),
			updatedAt: D("2025-01-07"),
			deletedAt: null,
		},
		// Persons — Alice + Bob both studied at RWTH and live in Berlin.
		{
			id: "ent_person_alice",
			type: PERSON,
			properties: {
				name: "Alice",
				role: "engineer",
				icon: { kind: "pack", value: "phosphor/user", color: "#e8b339" },
			},
			createdAt: D("2025-01-07"),
			updatedAt: D("2025-01-13"),
			deletedAt: null,
		},
		{
			id: "ent_person_bob",
			type: PERSON,
			properties: {
				name: "Bob",
				role: "researcher",
				icon: { kind: "pack", value: "phosphor/user" },
			},
			createdAt: D("2025-01-08"),
			updatedAt: D("2025-01-13"),
			deletedAt: null,
		},
		// Carla: studied at RWTH but lives in Munich (Berlin pattern shouldn't match).
		{
			id: "ent_person_carla",
			type: PERSON,
			properties: {
				name: "Carla",
				role: "designer",
				icon: { kind: "pack", value: "phosphor/user" },
			},
			createdAt: D("2025-01-09"),
			updatedAt: D("2025-01-13"),
			deletedAt: null,
		},
		// Dora: lives in Berlin but studied at ETH (no shared school with Alice/Bob).
		{
			id: "ent_person_dora",
			type: PERSON,
			properties: {
				name: "Dora",
				role: "engineer",
				icon: { kind: "pack", value: "phosphor/user" },
			},
			createdAt: D("2025-01-10"),
			updatedAt: D("2025-01-13"),
			deletedAt: null,
		},
		// Eve + Frank both studied at ETH and live in Berlin (second valid binding).
		{
			id: "ent_person_eve",
			type: PERSON,
			properties: {
				name: "Eve",
				role: "researcher",
				icon: { kind: "pack", value: "phosphor/user" },
			},
			createdAt: D("2025-01-11"),
			updatedAt: D("2025-01-14"),
			deletedAt: null,
		},
		{
			id: "ent_person_frank",
			type: PERSON,
			properties: {
				name: "Frank",
				role: "engineer",
				icon: { kind: "pack", value: "phosphor/user" },
			},
			createdAt: D("2025-01-12"),
			updatedAt: D("2025-01-14"),
			deletedAt: null,
		},
		// Greta: a person at MIT/Boston, completely outside the Berlin cluster.
		{
			id: "ent_person_greta",
			type: PERSON,
			properties: {
				name: "Greta",
				role: "engineer",
				icon: { kind: "emoji", value: "🧑‍🔬" },
			},
			createdAt: D("2025-01-13"),
			updatedAt: D("2025-01-13"),
			deletedAt: null,
		},
		// A few unrelated Notes so the "filter to pattern" effect is visible.
		{
			id: "ent_note_a",
			type: NOTE,
			properties: {
				title: "Q3 roadmap",
				icon: { kind: "pack", value: "phosphor/note-pencil" },
			},
			createdAt: D("2025-01-13"),
			updatedAt: D("2025-01-13"),
			deletedAt: null,
		},
		{
			id: "ent_note_b",
			type: NOTE,
			properties: {
				title: "Conference idea",
				// Image kind, exercised offline via a data URL (no network /
				// custom scheme) so the demo proves all three icon kinds.
				icon: {
					kind: "image",
					value:
						"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%237c5cff'/><circle cx='32' cy='32' r='14' fill='white'/></svg>",
				},
			},
			createdAt: D("2025-01-14"),
			updatedAt: D("2025-01-14"),
			deletedAt: null,
		},
	],
	links: [
		// Alice studied at RWTH.
		{
			id: "lnk_alice_rwth",
			sourceEntityId: "ent_person_alice",
			destEntityId: "ent_school_rwth",
			linkType: STUDIED_AT,
			createdAt: D("2025-01-07"),
			deletedAt: null,
		},
		// Bob studied at RWTH.
		{
			id: "lnk_bob_rwth",
			sourceEntityId: "ent_person_bob",
			destEntityId: "ent_school_rwth",
			linkType: STUDIED_AT,
			createdAt: D("2025-01-08"),
			deletedAt: null,
		},
		// Alice lives in Berlin.
		{
			id: "lnk_alice_berlin",
			sourceEntityId: "ent_person_alice",
			destEntityId: "ent_city_berlin",
			linkType: LIVES_IN,
			createdAt: D("2025-01-07"),
			deletedAt: null,
		},
		// Bob lives in Berlin.
		{
			id: "lnk_bob_berlin",
			sourceEntityId: "ent_person_bob",
			destEntityId: "ent_city_berlin",
			linkType: LIVES_IN,
			createdAt: D("2025-01-08"),
			deletedAt: null,
		},
		// Carla studied at RWTH.
		{
			id: "lnk_carla_rwth",
			sourceEntityId: "ent_person_carla",
			destEntityId: "ent_school_rwth",
			linkType: STUDIED_AT,
			createdAt: D("2025-01-09"),
			deletedAt: null,
		},
		// Carla lives in Munich — NOT Berlin.
		{
			id: "lnk_carla_munich",
			sourceEntityId: "ent_person_carla",
			destEntityId: "ent_city_munich",
			linkType: LIVES_IN,
			createdAt: D("2025-01-09"),
			deletedAt: null,
		},
		// Dora studied at ETH.
		{
			id: "lnk_dora_eth",
			sourceEntityId: "ent_person_dora",
			destEntityId: "ent_school_eth",
			linkType: STUDIED_AT,
			createdAt: D("2025-01-10"),
			deletedAt: null,
		},
		// Dora lives in Berlin.
		{
			id: "lnk_dora_berlin",
			sourceEntityId: "ent_person_dora",
			destEntityId: "ent_city_berlin",
			linkType: LIVES_IN,
			createdAt: D("2025-01-10"),
			deletedAt: null,
		},
		// Eve studied at ETH.
		{
			id: "lnk_eve_eth",
			sourceEntityId: "ent_person_eve",
			destEntityId: "ent_school_eth",
			linkType: STUDIED_AT,
			createdAt: D("2025-01-11"),
			deletedAt: null,
		},
		// Eve lives in Berlin.
		{
			id: "lnk_eve_berlin",
			sourceEntityId: "ent_person_eve",
			destEntityId: "ent_city_berlin",
			linkType: LIVES_IN,
			createdAt: D("2025-01-11"),
			deletedAt: null,
		},
		// Frank studied at ETH.
		{
			id: "lnk_frank_eth",
			sourceEntityId: "ent_person_frank",
			destEntityId: "ent_school_eth",
			linkType: STUDIED_AT,
			createdAt: D("2025-01-12"),
			deletedAt: null,
		},
		// Frank lives in Berlin.
		{
			id: "lnk_frank_berlin",
			sourceEntityId: "ent_person_frank",
			destEntityId: "ent_city_berlin",
			linkType: LIVES_IN,
			createdAt: D("2025-01-12"),
			deletedAt: null,
		},
		// Greta studied at MIT.
		{
			id: "lnk_greta_mit",
			sourceEntityId: "ent_person_greta",
			destEntityId: "ent_school_mit",
			linkType: STUDIED_AT,
			createdAt: D("2025-01-13"),
			deletedAt: null,
		},
		// Greta lives in Boston.
		{
			id: "lnk_greta_boston",
			sourceEntityId: "ent_person_greta",
			destEntityId: "ent_city_boston",
			linkType: LIVES_IN,
			createdAt: D("2025-01-13"),
			deletedAt: null,
		},
		// A note about Berlin (drives the "All entities" view's edge variety).
		{
			id: "lnk_note_a_berlin",
			sourceEntityId: "ent_note_a",
			destEntityId: "ent_city_berlin",
			linkType: ABOUT,
			createdAt: D("2025-01-13"),
			deletedAt: null,
		},
	],
};

/** Build a `GraphPattern` representing the canonical example. */
import { EdgeDirection, EdgeMatch, type GraphPattern, SubjectKind } from "../types/pattern";

export function canonicalBerlinPattern(): GraphPattern {
	return {
		subjects: {
			A: {
				kind: SubjectKind.Entity,
				types: [PERSON],
				where: null,
				displayName: "Person A",
				color: null,
				icon: null,
				limit: null,
			},
			B: {
				kind: SubjectKind.Entity,
				types: [PERSON],
				where: null,
				displayName: "Person B",
				color: null,
				icon: null,
				limit: null,
			},
			S: {
				kind: SubjectKind.Entity,
				types: [SCHOOL],
				where: null,
				displayName: "Shared school",
				color: null,
				icon: null,
				limit: null,
			},
			City: {
				kind: SubjectKind.Entity,
				types: [CITY],
				where: { $eq: { name: "Berlin" } },
				displayName: "Berlin",
				color: null,
				icon: null,
				limit: 1,
			},
		},
		edges: [
			{
				from: "A",
				to: "S",
				linkTypes: [STUDIED_AT],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1],
			},
			{
				from: "B",
				to: "S",
				linkTypes: [STUDIED_AT],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1],
			},
			{
				from: "A",
				to: "City",
				linkTypes: [LIVES_IN],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1],
			},
			{
				from: "B",
				to: "City",
				linkTypes: [LIVES_IN],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1],
			},
		],
		primarySubject: "A",
	};
}

/** A simple "show me every Note about a City" pattern — single-edge, used
 *  to demonstrate that simple patterns also work. */
export function notesAboutCitiesPattern(): GraphPattern {
	return {
		subjects: {
			N: {
				kind: SubjectKind.Entity,
				types: [NOTE],
				where: null,
				displayName: "Note",
				color: null,
				icon: null,
				limit: null,
			},
			C: {
				kind: SubjectKind.Entity,
				types: [CITY],
				where: null,
				displayName: "City",
				color: null,
				icon: null,
				limit: null,
			},
		},
		edges: [
			{
				from: "N",
				to: "C",
				linkTypes: [ABOUT],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1],
			},
		],
		primarySubject: "N",
	};
}
