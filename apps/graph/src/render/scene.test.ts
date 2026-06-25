import { describe, expect, it } from "vitest";
import { DEMO_GRAPH, canonicalBerlinPattern } from "../demo/dataset";
import { defaultPattern } from "../logic/pattern-edit";
import { HistoryReveal } from "../types/graph-view";
import {
	DEFAULT_SCENE_OPTIONS,
	EASE_WINDOW_MS,
	FALLBACK_GRAPH_THEME,
	RECENT_FLOOR_ALPHA,
	RECENT_WINDOW_MS,
	UNMATCHED_EDGE_DIM,
	UNMATCHED_NODE_DIM,
	buildScene,
	colorForType,
	computeRevealAlpha,
	sceneStats,
} from "./scene";

/** Opaque = `#rrggbb` / `#rgb`, never an `rgba(...)` with a < 1 alpha.
 *  Nodes and edges must never ship transparency baked into their colour —
 *  opacity is reserved for the history-reveal fade. */
const isOpaque = (color: string): boolean => /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color);

describe("buildScene with the canonical Berlin pattern", () => {
	it("attaches subject names to matched entities", () => {
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH);
		const aliceNode = scene.renderNodes.find((n) => n.id === "ent_person_alice");
		expect(aliceNode).toBeDefined();
		expect(aliceNode?.subjectName).not.toBeNull();
	});

	it("includes unmatched entities by default (showUnmatched: true) with no subject", () => {
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH);
		const greta = scene.renderNodes.find((n) => n.id === "ent_person_greta");
		expect(greta).toBeDefined();
		expect(greta?.subjectName).toBeNull();
	});

	it("dims unmatched entities so narrowing the pattern visibly filters", () => {
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH);
		const greta = scene.renderNodes.find((n) => n.id === "ent_person_greta");
		const alice = scene.renderNodes.find((n) => n.id === "ent_person_alice");
		expect(greta?.alpha).toBe(UNMATCHED_NODE_DIM);
		expect(alice?.alpha).toBe(1);
	});

	it("with the default match-everything pattern, nothing dims", () => {
		const scene = buildScene(defaultPattern(), DEMO_GRAPH);
		for (const node of scene.renderNodes) {
			expect(node.subjectName).not.toBeNull();
			expect(node.alpha).toBe(1);
		}
	});

	it("keeps edges under the default pattern with showUnmatched: false", () => {
		// Regression: edge visibility is endpoint-driven, not gated on
		// `matchResult.links`. The default node-only pattern binds no pattern
		// edges, so gating on that set hid every edge the moment the user turned
		// off "Filtered-out entities (dimmed)".
		const scene = buildScene(defaultPattern(), DEMO_GRAPH, {
			...DEFAULT_SCENE_OPTIONS,
			showUnmatched: false,
		});
		const liveEdges = DEMO_GRAPH.links.filter((l) => l.deletedAt === null).length;
		expect(scene.renderNodes.length).toBe(DEMO_GRAPH.entities.length);
		expect(scene.renderEdges.length).toBe(liveEdges);
	});

	it("with showUnmatched: false, omits Greta entirely", () => {
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH, {
			...DEFAULT_SCENE_OPTIONS,
			showUnmatched: false,
		});
		const greta = scene.renderNodes.find((n) => n.id === "ent_person_greta");
		expect(greta).toBeUndefined();
	});

	it("computes a non-null bounds range from the demo dataset", () => {
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH);
		expect(scene.bounds).not.toBeNull();
		if (!scene.bounds) return;
		expect(scene.bounds.max).toBeGreaterThan(scene.bounds.min);
	});
});

describe("sceneStats (the Filters-panel match summary)", () => {
	it("F-157: 'Visible edges' counts the edges the canvas paints, not pattern-bound links — the default no-edges pattern must not report 0 while edges render", () => {
		const scene = buildScene(defaultPattern(), DEMO_GRAPH);
		// The discrepancy: edges genuinely render…
		expect(scene.renderEdges.length).toBeGreaterThan(0);
		// …but a no-edge-constraint pattern binds no links.
		expect(scene.matchResult.links.size).toBe(0);
		const stats = sceneStats(scene);
		expect(stats.visibleEdges).toBe(scene.renderEdges.length);
	});

	it("'Visible nodes' counts the painted node set (all entities under showUnmatched)", () => {
		const scene = buildScene(defaultPattern(), DEMO_GRAPH);
		const stats = sceneStats(scene);
		expect(stats.visibleNodes).toBe(scene.renderNodes.length);
	});

	it("with showUnmatched: false, visible counts shrink to the matched subgraph", () => {
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH, {
			...DEFAULT_SCENE_OPTIONS,
			showUnmatched: false,
		});
		const stats = sceneStats(scene);
		expect(stats.visibleNodes).toBe(scene.renderNodes.length);
		expect(stats.visibleEdges).toBe(scene.renderEdges.length);
		expect(stats.bindings).toBe(scene.matchResult.matches.length);
		expect(stats.bindings).toBeGreaterThan(0);
	});
});

describe("colour-by-type", () => {
	const theme = FALLBACK_GRAPH_THEME;

	it("gives different first-party types distinct, opaque colours", () => {
		const note = colorForType("io.brainstorm.notes/Note/v1", theme);
		const task = colorForType("brainstorm/Task/v1", theme);
		expect(isOpaque(note)).toBe(true);
		expect(isOpaque(task)).toBe(true);
		expect(note).not.toBe(task);
	});

	it("is stable: the same type always resolves to the same colour", () => {
		expect(colorForType("brainstorm/Task/v1", theme)).toBe(colorForType("brainstorm/Task/v1", theme));
		// An unlisted type hashes deterministically (no per-render flicker).
		const a = colorForType("acme/Widget/v1", theme);
		const b = colorForType("acme/Widget/v1", theme);
		expect(a).toBe(b);
		expect(isOpaque(a)).toBe(true);
	});

	it("resolves namespaced suffix variants like defaultIconForType", () => {
		expect(colorForType("some.ns/Note/v3", theme)).toBe(
			colorForType("io.brainstorm.notes/Note/v1", theme),
		);
	});

	it("every node in the scene paints an opaque colour (no baked transparency)", () => {
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH);
		expect(scene.renderNodes.length).toBeGreaterThan(0);
		for (const n of scene.renderNodes) expect(isOpaque(n.color)).toBe(true);
	});

	it("edges paint an opaque colour at a legible base alpha (not washed out)", () => {
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH);
		expect(scene.renderEdges.length).toBeGreaterThan(0);
		const matched = new Set(scene.renderNodes.filter((n) => n.subjectName !== null).map((n) => n.id));
		let matchedEdges = 0;
		for (const e of scene.renderEdges) {
			expect(isOpaque(e.color)).toBe(true);
			if (matched.has(e.link.sourceEntityId) && matched.has(e.link.destEntityId)) {
				matchedEdges += 1;
				// Old behaviour multiplied a 0.3-alpha colour by 0.35 ≈ 0.1 — all
				// but invisible. The base level is now well above that.
				expect(e.alpha).toBeGreaterThanOrEqual(0.5);
			} else {
				// An edge into the filtered-out periphery recedes with its
				// endpoint instead of wiring the dimmed halo in at full strength.
				expect(e.alpha).toBeLessThanOrEqual(UNMATCHED_EDGE_DIM);
				expect(e.alpha).toBeGreaterThan(0);
			}
		}
		expect(matchedEdges).toBeGreaterThan(0);
	});
});

describe("buildScene with history cutoff", () => {
	it("drops entities created after the cutoff from the scene (topology, not opacity)", () => {
		// Alice is created 2025-01-07 in the compressed demo; a cutoff at the
		// start of the dataset (Jan 1) leaves her absent — the renderer paints
		// her at the moment her topology actually appears, so playback drives
		// real reheats of the force engine instead of an inert opacity fade.
		const earlyCutoff = new Date("2025-01-01").getTime();
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH, {
			...DEFAULT_SCENE_OPTIONS,
			cutoffAt: earlyCutoff,
		});
		const alice = scene.renderNodes.find((n) => n.id === "ent_person_alice");
		expect(alice).toBeUndefined();
	});

	it("paints entities created well before the cutoff at full alpha", () => {
		const lateCutoff = new Date("2025-12-31").getTime();
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH, {
			...DEFAULT_SCENE_OPTIONS,
			cutoffAt: lateCutoff,
		});
		const alice = scene.renderNodes.find((n) => n.id === "ent_person_alice");
		expect(alice?.alpha).toBe(1);
	});

	it("drops edges whose endpoints aren't both revealed yet", () => {
		// At an early cutoff Alice is gone (created Jan 7); any edge incident
		// to Alice must not survive into the scene — a dangling edge would
		// crash the layout reconciler.
		const earlyCutoff = new Date("2025-01-01").getTime();
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH, {
			...DEFAULT_SCENE_OPTIONS,
			cutoffAt: earlyCutoff,
		});
		const ids = new Set(scene.renderNodes.map((n) => n.id));
		for (const edge of scene.renderEdges) {
			expect(ids.has(edge.link.sourceEntityId)).toBe(true);
			expect(ids.has(edge.link.destEntityId)).toBe(true);
		}
	});

	it("Strict and Eased pop revealed nodes in at alpha 1 (no opacity fade)", () => {
		// Under the new contract Strict and Eased are equivalent: items past
		// the cutoff render at alpha 1, items before the cutoff are filtered
		// out by the scene. The single-tick reveal is what makes the layout
		// actually rearrange during playback.
		const aliceCreated = new Date("2025-01-07").getTime();
		for (const reveal of [HistoryReveal.Strict, HistoryReveal.Eased]) {
			const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH, {
				...DEFAULT_SCENE_OPTIONS,
				cutoffAt: aliceCreated,
				reveal,
			});
			const alice = scene.renderNodes.find((n) => n.id === "ent_person_alice");
			expect(alice?.alpha).toBe(1);
		}
	});

	it("with cutoffAt=null, every matched node has alpha 1 (reveal never dims the present)", () => {
		// `defaultPattern` matches everything, so the only alpha input left is
		// the reveal cutoff — which is off here.
		const scene = buildScene(defaultPattern(), DEMO_GRAPH, {
			...DEFAULT_SCENE_OPTIONS,
			cutoffAt: null,
		});
		for (const node of scene.renderNodes) {
			expect(node.alpha).toBe(1);
		}
	});
});

describe("buildScene universal-icon resolution", () => {
	const node = (id: string) =>
		buildScene(canonicalBerlinPattern(), DEMO_GRAPH).renderNodes.find((n) => n.id === id);

	it("resolves a pack icon (with colour) on a matched node", () => {
		const alice = node("ent_person_alice");
		expect(alice?.icon).toEqual({ kind: "pack", value: "phosphor/user", color: "#e8b339" });
		expect(alice?.iconSrc).toBe("pack:phosphor/user");
	});

	it("resolves an emoji icon and still exposes it as the glyph fallback", () => {
		const berlin = node("ent_city_berlin");
		expect(berlin?.icon).toEqual({ kind: "emoji", value: "🏙️" });
		expect(berlin?.iconSrc).toBe("emoji:🏙️");
		// Emoji doubles as the SVG-renderer / loading fallback glyph.
		expect(berlin?.glyph).toBe("🏙️");
	});

	it("still resolves an unmatched node's OWN Image icon (per-object-icons-everywhere)", () => {
		// `ent_note_b` carries an Image icon and is outside the Berlin
		// pattern: it still MUST show its own icon — pattern membership never
		// gates icon visibility (and colour is by type, not match state).
		const conf = node("ent_note_b");
		expect(conf?.subjectName).toBeNull();
		expect(conf?.icon?.kind).toBe("image");
		expect(conf?.iconSrc.startsWith("image:")).toBe(true);
	});

	it("still resolves an unmatched node's OWN emoji icon (fail-open, not subject-gated)", () => {
		// Greta has an emoji icon and is outside the Berlin pattern — the
		// icon still resolves regardless of match state (colour is by type).
		const greta = node("ent_person_greta");
		expect(greta?.subjectName).toBeNull();
		expect(greta?.icon).toEqual({ kind: "emoji", value: "🧑‍🔬" });
		expect(greta?.iconSrc).toBe("emoji:🧑‍🔬");
	});

	it("drops every icon when showIcons is off", () => {
		const scene = buildScene(canonicalBerlinPattern(), DEMO_GRAPH, {
			...DEFAULT_SCENE_OPTIONS,
			showIcons: false,
		});
		expect(scene.renderNodes.every((n) => n.icon === null && n.iconSrc === "")).toBe(true);
	});

	it("keeps the object's own pack icon and never fabricates a type glyph", () => {
		// RWTH carries its OWN pack icon → that icon is used (rendered as a
		// texture). No emoji glyph is invented as a fallback: product
		// decision is "no icons the object doesn't actually have", so
		// `glyph` is empty (a plain disc shows until/unless the pack
		// texture rasterises).
		const rwth = node("ent_school_rwth");
		expect(rwth?.icon).toEqual({ kind: "pack", value: "phosphor/graduation-cap" });
		expect(rwth?.glyph).toBe("");
	});
});

describe("computeRevealAlpha", () => {
	const cutoff = 1_000_000_000_000;

	it("history off (cutoffAt null) → fully opaque in every mode", () => {
		for (const r of [HistoryReveal.Strict, HistoryReveal.Eased, HistoryReveal.Recent]) {
			expect(computeRevealAlpha(cutoff, null, r, EASE_WINDOW_MS, RECENT_WINDOW_MS)).toBe(1);
		}
	});

	it("Strict is a hard step at the cutoff", () => {
		const f = (created: number) =>
			computeRevealAlpha(created, cutoff, HistoryReveal.Strict, EASE_WINDOW_MS, RECENT_WINDOW_MS);
		expect(f(cutoff - 1)).toBe(1); // existed by the cutoff
		expect(f(cutoff)).toBe(1); // exactly at the cutoff
		expect(f(cutoff + 1)).toBe(0); // not yet created
	});

	it("Eased now matches Strict — a hard pop, not a centred fade", () => {
		// Eased used to interpolate across a window centred on `created_at`;
		// that path was paired with the opacity-only reveal and meant
		// playback didn't change the scene topology. With reveal now a
		// topology gate in `buildScene`, both modes return a hard step here
		// and the actual playback motion comes from the force engine
		// reheating each time a new entity drops into the scene.
		const f = (created: number) =>
			computeRevealAlpha(created, cutoff, HistoryReveal.Eased, EASE_WINDOW_MS, RECENT_WINDOW_MS);
		expect(f(cutoff - 1)).toBe(1);
		expect(f(cutoff)).toBe(1);
		expect(f(cutoff + 1)).toBe(0);
	});

	it("Recent: not-yet-created → 0, fresh → 1, then comet-tail fade to the floor", () => {
		const f = (created: number) =>
			computeRevealAlpha(created, cutoff, HistoryReveal.Recent, EASE_WINDOW_MS, RECENT_WINDOW_MS);
		expect(f(cutoff + 1)).toBe(0); // after the cutoff
		expect(f(cutoff)).toBe(1); // just appeared
		expect(f(cutoff - RECENT_WINDOW_MS)).toBe(1); // edge of the lit window
		// Half-way through the fade span → half-way between 1 and the floor.
		const mid = f(cutoff - RECENT_WINDOW_MS - RECENT_WINDOW_MS / 2);
		expect(mid).toBeCloseTo(1 - 0.5 * (1 - RECENT_FLOOR_ALPHA), 6);
		// Long-settled element clamps at the floor, never 0.
		expect(f(cutoff - RECENT_WINDOW_MS * 50)).toBe(RECENT_FLOOR_ALPHA);
	});

	it("every mode returns a value within [0, 1]", () => {
		for (const r of [HistoryReveal.Strict, HistoryReveal.Eased, HistoryReveal.Recent]) {
			for (const created of [cutoff - 5e9, cutoff - 1, cutoff, cutoff + 1, cutoff + 5e9]) {
				const a = computeRevealAlpha(created, cutoff, r, EASE_WINDOW_MS, RECENT_WINDOW_MS);
				expect(a).toBeGreaterThanOrEqual(0);
				expect(a).toBeLessThanOrEqual(1);
			}
		}
	});
});
