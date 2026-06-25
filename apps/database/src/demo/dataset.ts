/**
 * Demo dataset used by the Database app preview drop. Eight typed entity
 * kinds (Task / Note / Person / Movie / Book / Trip / Photo / Article) and
 * four hand-crafted Lists exercising each of the six view kinds.
 *
 * Each List demonstrates a distinct value of the renderer:
 *   - Tasks: Grid + Board (group-by status), default sort by priority
 *   - Movies: Gallery (cover image), grid fallback
 *   - Reading log: List (title + chip strip), Gallery
 *   - Trip itinerary: Timeline (spans with end dates), Calendar (start date)
 *
 * Survives the entities-service swap: `entities.subscribe` returns the same
 * `EntityRow` / `LinkRow` shapes; only the source of the snapshot changes.
 */

import type { EntityRow, InMemoryEntities } from "../logic/in-memory-entities";
import type { List } from "../types/list";
import { ListSourceKind } from "../types/list-source";
import {
	CalendarRange,
	CalendarWeekStart,
	type ColumnSpec,
	EmptyPlacement,
	type GridLayoutOptions,
	type ListView,
	ListViewKind,
	SortDirection,
	type SortKey,
	TimelineDensity,
} from "../types/list-view";

const D = (iso: string): number => new Date(iso).getTime();

const NOW = D("2026-05-13");

export const TASK_TYPE = "io.brainstorm.demo/Task/v1";
export const NOTE_TYPE = "io.brainstorm.demo/Note/v1";
export const PERSON_TYPE = "io.brainstorm.demo/Person/v1";
export const MOVIE_TYPE = "io.brainstorm.demo/Movie/v1";
export const BOOK_TYPE = "io.brainstorm.demo/Book/v1";
export const TRIP_TYPE = "io.brainstorm.demo/Trip/v1";
export const PHOTO_TYPE = "io.brainstorm.demo/Photo/v1";
export const ARTICLE_TYPE = "io.brainstorm.demo/Article/v1";

export const TYPE_LABELS: Record<string, string> = {
	[TASK_TYPE]: "Task",
	[NOTE_TYPE]: "Note",
	[PERSON_TYPE]: "Person",
	[MOVIE_TYPE]: "Movie",
	[BOOK_TYPE]: "Book",
	[TRIP_TYPE]: "Trip",
	[PHOTO_TYPE]: "Photo",
	[ARTICLE_TYPE]: "Article",
};

/** Stand-in for the vault-level property dictionaries that the Properties
 *  UI will hand the renderer post-Stage 9.3. Each entry models the
 *  composable property model's `vocabulary` modifier: one row per allowed
 *  value carrying the user-chosen colour. When the real dictionary store
 *  lands ([[project_properties_are_vault_level]] +
 *  [[project_composable_property_model]]) this constant gets removed; the
 *  lookup signature already matches what the SDK will expose. */
type VocabularyEntry = { value: string; color: string };
type PropertyDictionary = { vocabulary: ReadonlyArray<VocabularyEntry> };

const DEMO_PROPERTY_DICTIONARIES: Record<string, PropertyDictionary> = {
	status: {
		vocabulary: [
			{ value: "Backlog", color: "#94a3b8" },
			{ value: "In progress", color: "#fbbf24" },
			{ value: "In review", color: "#a78bfa" },
			{ value: "Done", color: "#34d399" },
			{ value: "Blocked", color: "#f87171" },
		],
	},
	priority: {
		vocabulary: [
			{ value: "Low", color: "#94a3b8" },
			{ value: "Medium", color: "#60a5fa" },
			{ value: "High", color: "#fb923c" },
			{ value: "Critical", color: "#f43f5e" },
		],
	},
	rating: {
		vocabulary: [
			{ value: "★", color: "#525252" },
			{ value: "★★", color: "#737373" },
			{ value: "★★★", color: "#a3a3a3" },
			{ value: "★★★★", color: "#fbbf24" },
			{ value: "★★★★★", color: "#fbbf24" },
		],
	},
};

/** Resolve the colour the user assigned to a vocabulary value through the
 *  Properties UI. Looks up the property's dictionary; returns null when the
 *  property has no vocabulary modifier or the value is free-form. */
export function demoVocabularyColor(propertyId: string, value: string): string | null {
	const dict = DEMO_PROPERTY_DICTIONARIES[propertyId];
	if (!dict) return null;
	return dict.vocabulary.find((entry) => entry.value === value)?.color ?? null;
}

function entity(
	id: string,
	type: string,
	properties: Record<string, unknown>,
	createdAt: number,
	updatedAt: number = createdAt,
): EntityRow {
	return { id, type, properties, createdAt, updatedAt, deletedAt: null };
}

/* ── Tasks (Grid + Board + Timeline) ─────────────────────────────────── */

const TASKS: EntityRow[] = [
	entity(
		"task_001",
		TASK_TYPE,
		{
			title: "Onboarding doc for new hires",
			status: "In progress",
			priority: "High",
			assignee: "Alice",
			dueDate: D("2026-05-20"),
			startDate: D("2026-05-08"),
			estimate: 8,
			completed: false,
			tags: ["docs", "team"],
		},
		D("2026-05-01"),
	),
	entity(
		"task_002",
		TASK_TYPE,
		{
			title: "Migrate legacy auth middleware",
			status: "Blocked",
			priority: "Critical",
			assignee: "Bob",
			dueDate: D("2026-05-19"),
			startDate: D("2026-05-05"),
			estimate: 16,
			completed: false,
			tags: ["security", "infra"],
		},
		D("2026-05-02"),
	),
	entity(
		"task_003",
		TASK_TYPE,
		{
			title: "Pricing page A/B test",
			status: "In review",
			priority: "Medium",
			assignee: "Carla",
			dueDate: D("2026-05-22"),
			startDate: D("2026-05-12"),
			estimate: 4,
			completed: false,
			tags: ["marketing"],
		},
		D("2026-05-04"),
	),
	entity(
		"task_004",
		TASK_TYPE,
		{
			title: "Quarterly retro notes",
			status: "Done",
			priority: "Low",
			assignee: "Alice",
			dueDate: D("2026-05-09"),
			startDate: D("2026-05-07"),
			estimate: 2,
			completed: true,
			tags: ["team"],
		},
		D("2026-04-30"),
	),
	entity(
		"task_005",
		TASK_TYPE,
		{
			title: "Triage P2 bugs",
			status: "Backlog",
			priority: "Medium",
			assignee: "Dario",
			dueDate: D("2026-05-26"),
			startDate: D("2026-05-19"),
			estimate: 6,
			completed: false,
			tags: ["bugs"],
		},
		D("2026-05-05"),
	),
	entity(
		"task_006",
		TASK_TYPE,
		{
			title: "Renew SSL certificate",
			status: "In progress",
			priority: "High",
			assignee: "Bob",
			dueDate: D("2026-05-15"),
			startDate: D("2026-05-11"),
			estimate: 1,
			completed: false,
			tags: ["infra"],
		},
		D("2026-05-09"),
	),
	entity(
		"task_007",
		TASK_TYPE,
		{
			title: "Re-record onboarding video",
			status: "Backlog",
			priority: "Low",
			assignee: "Carla",
			dueDate: D("2026-06-02"),
			startDate: D("2026-05-26"),
			estimate: 5,
			completed: false,
			tags: ["docs"],
		},
		D("2026-05-08"),
	),
	entity(
		"task_008",
		TASK_TYPE,
		{
			title: "Audit dashboard tokens",
			status: "Done",
			priority: "Medium",
			assignee: "Alice",
			dueDate: D("2026-05-06"),
			startDate: D("2026-05-04"),
			estimate: 3,
			completed: true,
			tags: ["design"],
		},
		D("2026-05-01"),
	),
	entity(
		"task_009",
		TASK_TYPE,
		{
			title: "Cost report for finance review",
			status: "In review",
			priority: "High",
			assignee: "Dario",
			dueDate: D("2026-05-18"),
			startDate: D("2026-05-10"),
			estimate: 6,
			completed: false,
			tags: ["finance"],
		},
		D("2026-05-04"),
	),
	entity(
		"task_010",
		TASK_TYPE,
		{
			title: "Ship release notes draft",
			status: "In progress",
			priority: "Medium",
			assignee: "Carla",
			dueDate: D("2026-05-17"),
			startDate: D("2026-05-13"),
			estimate: 2,
			completed: false,
			tags: ["docs", "release"],
		},
		D("2026-05-12"),
	),
];

/* ── Movies (Gallery) ─────────────────────────────────────────────────── */

const MOVIES: EntityRow[] = [
	entity(
		"mov_001",
		MOVIE_TYPE,
		{
			title: "Dune: Part Two",
			year: 2024,
			director: "Denis Villeneuve",
			runtime: 166,
			rating: "★★★★★",
			genre: "Sci-fi",
			watchedDate: D("2024-03-12"),
			cover: "gradient:#ce6e2a:#502518",
			tagline: "Long live the fighters.",
		},
		D("2024-03-13"),
	),
	entity(
		"mov_002",
		MOVIE_TYPE,
		{
			title: "Past Lives",
			year: 2023,
			director: "Celine Song",
			runtime: 105,
			rating: "★★★★",
			genre: "Drama",
			watchedDate: D("2024-01-22"),
			cover: "gradient:#5b6fa6:#1d2640",
			tagline: "What if?",
		},
		D("2024-01-22"),
	),
	entity(
		"mov_003",
		MOVIE_TYPE,
		{
			title: "Anatomy of a Fall",
			year: 2023,
			director: "Justine Triet",
			runtime: 151,
			rating: "★★★★",
			genre: "Drama",
			watchedDate: D("2024-02-08"),
			cover: "gradient:#dadada:#7a7a7a",
			tagline: "Did she?",
		},
		D("2024-02-08"),
	),
	entity(
		"mov_004",
		MOVIE_TYPE,
		{
			title: "Oppenheimer",
			year: 2023,
			director: "Christopher Nolan",
			runtime: 180,
			rating: "★★★★★",
			genre: "Biography",
			watchedDate: D("2023-07-23"),
			cover: "gradient:#1a0a05:#5e2210",
			tagline: "I am become Death.",
		},
		D("2023-07-23"),
	),
	entity(
		"mov_005",
		MOVIE_TYPE,
		{
			title: "The Zone of Interest",
			year: 2023,
			director: "Jonathan Glazer",
			runtime: 105,
			rating: "★★★★",
			genre: "Drama",
			watchedDate: D("2024-02-18"),
			cover: "gradient:#3d4528:#161a0f",
			tagline: "An ordinary family.",
		},
		D("2024-02-18"),
	),
	entity(
		"mov_006",
		MOVIE_TYPE,
		{
			title: "Poor Things",
			year: 2023,
			director: "Yorgos Lanthimos",
			runtime: 141,
			rating: "★★★★★",
			genre: "Comedy",
			watchedDate: D("2024-01-30"),
			cover: "gradient:#b66684:#3c2031",
			tagline: "What a wonderful world.",
		},
		D("2024-01-30"),
	),
	entity(
		"mov_007",
		MOVIE_TYPE,
		{
			title: "Killers of the Flower Moon",
			year: 2023,
			director: "Martin Scorsese",
			runtime: 206,
			rating: "★★★",
			genre: "Crime",
			watchedDate: D("2023-11-04"),
			cover: "gradient:#7a3a1c:#23130b",
			tagline: "The Osage murders.",
		},
		D("2023-11-04"),
	),
	entity(
		"mov_008",
		MOVIE_TYPE,
		{
			title: "Asteroid City",
			year: 2023,
			director: "Wes Anderson",
			runtime: 105,
			rating: "★★★",
			genre: "Comedy",
			watchedDate: D("2023-09-15"),
			cover: "gradient:#e8b75c:#7a4a14",
			tagline: "You can't wake up if you don't fall asleep.",
		},
		D("2023-09-15"),
	),
];

/* ── Reading log (List + Gallery) ─────────────────────────────────────── */

const BOOKS: EntityRow[] = [
	entity(
		"bk_001",
		BOOK_TYPE,
		{
			title: "Tomorrow, and Tomorrow, and Tomorrow",
			author: "Gabrielle Zevin",
			startedDate: D("2026-03-14"),
			finishedDate: D("2026-04-02"),
			rating: "★★★★★",
			pages: 416,
			status: "Done",
			cover: "gradient:#e0d2b4:#7a6841",
		},
		D("2026-03-14"),
	),
	entity(
		"bk_002",
		BOOK_TYPE,
		{
			title: "The Three-Body Problem",
			author: "Liu Cixin",
			startedDate: D("2026-04-04"),
			finishedDate: D("2026-04-30"),
			rating: "★★★★",
			pages: 400,
			status: "Done",
			cover: "gradient:#1a3358:#06101f",
		},
		D("2026-04-04"),
	),
	entity(
		"bk_003",
		BOOK_TYPE,
		{
			title: "Klara and the Sun",
			author: "Kazuo Ishiguro",
			startedDate: D("2026-05-02"),
			finishedDate: null,
			rating: null,
			pages: 320,
			status: "In progress",
			cover: "gradient:#f0d28a:#7a6433",
		},
		D("2026-05-02"),
	),
	entity(
		"bk_004",
		BOOK_TYPE,
		{
			title: "Annihilation",
			author: "Jeff VanderMeer",
			startedDate: D("2026-02-04"),
			finishedDate: D("2026-02-25"),
			rating: "★★★★",
			pages: 208,
			status: "Done",
			cover: "gradient:#1d6b3a:#0c2916",
		},
		D("2026-02-04"),
	),
	entity(
		"bk_005",
		BOOK_TYPE,
		{
			title: "Pachinko",
			author: "Min Jin Lee",
			startedDate: D("2026-01-10"),
			finishedDate: D("2026-02-02"),
			rating: "★★★★★",
			pages: 496,
			status: "Done",
			cover: "gradient:#9c3a5e:#3a1424",
		},
		D("2026-01-10"),
	),
	entity(
		"bk_006",
		BOOK_TYPE,
		{
			title: "The Overstory",
			author: "Richard Powers",
			startedDate: D("2025-12-01"),
			finishedDate: D("2026-01-08"),
			rating: "★★★★",
			pages: 502,
			status: "Done",
			cover: "gradient:#3a5a3a:#142214",
		},
		D("2025-12-01"),
	),
];

/* ── Trip (Timeline + Calendar) ───────────────────────────────────────── */

const TRIPS: EntityRow[] = [
	entity(
		"trip_001",
		TRIP_TYPE,
		{
			title: "Flight LH123 SFO → FRA",
			category: "Flight",
			startDate: D("2026-05-14T11:00:00Z"),
			endDate: D("2026-05-14T21:00:00Z"),
			confirmation: "ABC123",
			cost: 820,
		},
		D("2026-04-01"),
	),
	entity(
		"trip_002",
		TRIP_TYPE,
		{
			title: "Hotel Adlon Berlin",
			category: "Hotel",
			startDate: D("2026-05-15"),
			endDate: D("2026-05-18"),
			confirmation: "ADL98",
			cost: 540,
		},
		D("2026-04-01"),
	),
	entity(
		"trip_003",
		TRIP_TYPE,
		{
			title: "Train Berlin → Munich",
			category: "Train",
			startDate: D("2026-05-18T09:00:00Z"),
			endDate: D("2026-05-18T13:30:00Z"),
			confirmation: "DB22091",
			cost: 110,
		},
		D("2026-04-02"),
	),
	entity(
		"trip_004",
		TRIP_TYPE,
		{
			title: "Hotel Bayerischer Hof",
			category: "Hotel",
			startDate: D("2026-05-18"),
			endDate: D("2026-05-20"),
			confirmation: "BYRH7",
			cost: 360,
		},
		D("2026-04-02"),
	),
	entity(
		"trip_005",
		TRIP_TYPE,
		{
			title: "Dinner at Tantris",
			category: "Meal",
			startDate: D("2026-05-19T19:30:00Z"),
			endDate: null,
			confirmation: null,
			cost: 180,
		},
		D("2026-04-15"),
	),
	entity(
		"trip_006",
		TRIP_TYPE,
		{
			title: "Flight LH456 MUC → SFO",
			category: "Flight",
			startDate: D("2026-05-20T13:00:00Z"),
			endDate: D("2026-05-21T01:00:00Z"),
			confirmation: "DEF456",
			cost: 1100,
		},
		D("2026-04-01"),
	),
];

/* ── Misc filler (Notes, People, Articles) — for vault feel ────────── */

const NOTES: EntityRow[] = [
	entity(
		"note_001",
		NOTE_TYPE,
		{ title: "On note-taking in 2026", body: "draft", pinned: true, tags: ["meta"] },
		D("2026-05-05"),
	),
	entity(
		"note_002",
		NOTE_TYPE,
		{ title: "Investment thesis: vertical AI", body: "draft", pinned: false, tags: ["finance"] },
		D("2026-04-22"),
	),
	entity(
		"note_003",
		NOTE_TYPE,
		{ title: "Design system audit", body: "draft", pinned: false, tags: ["design"] },
		D("2026-05-09"),
	),
];

const PEOPLE: EntityRow[] = [
	entity(
		"person_alice",
		PERSON_TYPE,
		{ name: "Alice", role: "Engineer", team: "Platform" },
		D("2025-01-04"),
	),
	entity(
		"person_bob",
		PERSON_TYPE,
		{ name: "Bob", role: "Engineer", team: "Security" },
		D("2025-01-04"),
	),
	entity(
		"person_carla",
		PERSON_TYPE,
		{ name: "Carla", role: "Designer", team: "Marketing" },
		D("2025-01-04"),
	),
	entity(
		"person_dario",
		PERSON_TYPE,
		{ name: "Dario", role: "Manager", team: "Platform" },
		D("2025-01-04"),
	),
];

export const DEMO_ENTITIES: InMemoryEntities = {
	entities: [...TASKS, ...MOVIES, ...BOOKS, ...TRIPS, ...NOTES, ...PEOPLE],
	links: [],
};

/* ── Demo lists + views ──────────────────────────────────────────────── */

function gridLayout(): GridLayoutOptions {
	return { rowHeight: "comfortable", showRowNumbers: false, pinFirstColumn: true };
}

function col(propertyId: string, width?: number): ColumnSpec {
	return width === undefined ? { propertyId, visible: true } : { propertyId, width, visible: true };
}

function sort(propertyId: string, direction: SortDirection = SortDirection.Asc): SortKey {
	return { propertyId, direction, emptyPlacement: EmptyPlacement.End };
}

type ViewDefaults =
	| "filters"
	| "sorts"
	| "groupBy"
	| "coverProperty"
	| "cardSubtitleProperty"
	| "columns"
	| "defaultTypeUrl"
	| "defaultTemplate"
	| "pageSize"
	| "layoutOptions";

function view(
	partial: Omit<ListView, ViewDefaults> & Partial<Pick<ListView, ViewDefaults>>,
): ListView {
	return {
		filters: null,
		sorts: [],
		groupBy: null,
		coverProperty: null,
		cardSubtitleProperty: null,
		columns: [],
		defaultTypeUrl: null,
		defaultTemplate: null,
		pageSize: 50,
		layoutOptions: gridLayout(),
		...partial,
	};
}

export const TASKS_LIST_ID = "list_tasks";
export const MOVIES_LIST_ID = "list_movies";
export const BOOKS_LIST_ID = "list_books";
export const TRIP_LIST_ID = "list_trip";

export const DEMO_LISTS: List[] = [
	{
		id: TASKS_LIST_ID,
		name: "All tasks",
		icon: null,
		description: "Everything tracked across all teams.",
		source: { kind: ListSourceKind.ByType, types: [TASK_TYPE] },
		members: { include: [], exclude: [] },
		views: ["view_tasks_grid", "view_tasks_board", "view_tasks_calendar", "view_tasks_timeline"],
		defaultViewId: "view_tasks_grid",
		defaultTemplate: null,
		createdAt: D("2026-04-01"),
		updatedAt: NOW,
	},
	{
		id: MOVIES_LIST_ID,
		name: "Recent movies",
		icon: null,
		description: "Films watched in the last two years.",
		source: { kind: ListSourceKind.ByType, types: [MOVIE_TYPE] },
		members: { include: [], exclude: [] },
		views: ["view_movies_gallery", "view_movies_grid"],
		defaultViewId: "view_movies_gallery",
		defaultTemplate: null,
		createdAt: D("2024-01-01"),
		updatedAt: NOW,
	},
	{
		id: BOOKS_LIST_ID,
		name: "Reading log",
		icon: null,
		description: "Books I've started or finished.",
		source: { kind: ListSourceKind.ByType, types: [BOOK_TYPE] },
		members: { include: [], exclude: [] },
		views: ["view_books_list", "view_books_gallery"],
		defaultViewId: "view_books_list",
		defaultTemplate: null,
		createdAt: D("2025-12-01"),
		updatedAt: NOW,
	},
	{
		id: TRIP_LIST_ID,
		name: "Berlin / Munich trip",
		icon: null,
		description: "Itinerary for May 14–20.",
		source: { kind: ListSourceKind.ByType, types: [TRIP_TYPE] },
		members: { include: [], exclude: [] },
		views: ["view_trip_timeline", "view_trip_calendar", "view_trip_grid"],
		defaultViewId: "view_trip_timeline",
		defaultTemplate: null,
		createdAt: D("2026-04-01"),
		updatedAt: NOW,
	},
];

export const DEMO_VIEWS: ListView[] = [
	view({
		id: "view_tasks_grid",
		listId: TASKS_LIST_ID,
		name: "Grid",
		icon: null,
		kind: ListViewKind.Grid,
		columns: [
			col("title", 280),
			col("status", 130),
			col("priority", 110),
			col("assignee", 120),
			col("dueDate", 130),
			col("estimate", 90),
			col("tags", 180),
		],
		sorts: [sort("dueDate", SortDirection.Asc)],
	}),
	view({
		id: "view_tasks_board",
		listId: TASKS_LIST_ID,
		name: "By status",
		icon: null,
		kind: ListViewKind.Board,
		groupBy: { propertyId: "status" },
		cardSubtitleProperty: "assignee",
		columns: [col("priority"), col("dueDate"), col("assignee")],
		layoutOptions: { columnWidth: 280, collapseEmptyColumns: false, cardPreview: "rich" },
	}),
	view({
		id: "view_tasks_calendar",
		listId: TASKS_LIST_ID,
		name: "Due dates",
		icon: null,
		kind: ListViewKind.Calendar,
		groupBy: { propertyId: "dueDate" },
		columns: [col("status")],
		layoutOptions: {
			range: CalendarRange.Month,
			startWeekOn: CalendarWeekStart.Monday,
			primaryDateProperty: "dueDate",
			colorBy: "status",
			dateRangeStart: "startDate",
			dateRangeEnd: "dueDate",
		},
	}),
	view({
		id: "view_tasks_timeline",
		listId: TASKS_LIST_ID,
		name: "Schedule",
		icon: null,
		kind: ListViewKind.Timeline,
		groupBy: { propertyId: "assignee" },
		columns: [col("status"), col("priority")],
		layoutOptions: {
			primaryDateProperty: "startDate",
			endDateProperty: "dueDate",
			swimlaneBy: "assignee",
			pxPerDay: 32,
			showNow: true,
			showWeekends: true,
			dependencyLinkTypes: [],
			showDependencies: false,
			density: TimelineDensity.Comfortable,
			colorBy: "status",
			labelProperty: "title",
		},
	}),
	view({
		id: "view_movies_gallery",
		listId: MOVIES_LIST_ID,
		name: "Gallery",
		icon: null,
		kind: ListViewKind.Gallery,
		coverProperty: "cover",
		cardSubtitleProperty: "director",
		columns: [col("year"), col("rating"), col("genre")],
		sorts: [sort("watchedDate", SortDirection.Desc)],
		layoutOptions: { thumbnailSize: "medium", cardAspectRatio: "portrait", showFilename: false },
	}),
	view({
		id: "view_movies_grid",
		listId: MOVIES_LIST_ID,
		name: "Grid",
		icon: null,
		kind: ListViewKind.Grid,
		columns: [
			col("title", 260),
			col("year", 80),
			col("director", 160),
			col("rating", 100),
			col("genre", 110),
			col("runtime", 90),
			col("watchedDate", 130),
		],
		sorts: [sort("watchedDate", SortDirection.Desc)],
	}),
	view({
		id: "view_books_list",
		listId: BOOKS_LIST_ID,
		name: "List",
		icon: null,
		kind: ListViewKind.List,
		columns: [col("author"), col("status"), col("rating"), col("pages")],
		sorts: [sort("startedDate", SortDirection.Desc)],
		layoutOptions: { density: "comfortable", showIcon: true },
	}),
	view({
		id: "view_books_gallery",
		listId: BOOKS_LIST_ID,
		name: "Gallery",
		icon: null,
		kind: ListViewKind.Gallery,
		coverProperty: "cover",
		cardSubtitleProperty: "author",
		columns: [col("rating"), col("status"), col("pages")],
		sorts: [sort("startedDate", SortDirection.Desc)],
		layoutOptions: { thumbnailSize: "medium", cardAspectRatio: "portrait", showFilename: false },
	}),
	view({
		id: "view_trip_timeline",
		listId: TRIP_LIST_ID,
		name: "Timeline",
		icon: null,
		kind: ListViewKind.Timeline,
		columns: [col("category"), col("cost")],
		layoutOptions: {
			primaryDateProperty: "startDate",
			endDateProperty: "endDate",
			swimlaneBy: "category",
			pxPerDay: 220,
			showNow: true,
			showWeekends: true,
			dependencyLinkTypes: [],
			showDependencies: false,
			density: TimelineDensity.Compact,
			colorBy: "category",
			labelProperty: "title",
		},
	}),
	view({
		id: "view_trip_calendar",
		listId: TRIP_LIST_ID,
		name: "Calendar",
		icon: null,
		kind: ListViewKind.Calendar,
		groupBy: { propertyId: "startDate" },
		columns: [col("category")],
		layoutOptions: {
			range: CalendarRange.Month,
			startWeekOn: CalendarWeekStart.Monday,
			primaryDateProperty: "startDate",
			colorBy: "category",
			dateRangeStart: "startDate",
			dateRangeEnd: "endDate",
		},
	}),
	view({
		id: "view_trip_grid",
		listId: TRIP_LIST_ID,
		name: "Grid",
		icon: null,
		kind: ListViewKind.Grid,
		columns: [
			col("title", 260),
			col("category", 110),
			col("startDate", 160),
			col("endDate", 160),
			col("cost", 100),
			col("confirmation", 130),
		],
		sorts: [sort("startDate", SortDirection.Asc)],
	}),
];

export function viewsForList(listId: string): ListView[] {
	return DEMO_VIEWS.filter((v) => v.listId === listId);
}

export function viewById(viewId: string): ListView | undefined {
	return DEMO_VIEWS.find((v) => v.id === viewId);
}
