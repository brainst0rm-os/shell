import { describe, expect, it } from "vitest";
import { GraphViewKind, LayoutKind, PathAlgorithm } from "../types/graph-view";
import { EdgeDirection } from "../types/pattern";
import {
	defaultLayoutForFull,
	defaultLayoutForLocal,
	defaultLayoutForPath,
	layoutMatchesViewKind,
} from "./derive-view-kind";

describe("default layout factories", () => {
	it("Full → Force layout with null force params and no initial center", () => {
		const l = defaultLayoutForFull();
		expect(l.kind).toBe(GraphViewKind.Full);
		expect(l.layout).toBe(LayoutKind.Force);
		expect(l.forceParams).toBeNull();
		expect(l.initialCenter).toBeNull();
	});

	it("Local → Radial layout, depth 2, both directions", () => {
		const l = defaultLayoutForLocal("ent_root");
		expect(l.kind).toBe(GraphViewKind.Local);
		expect(l.layout).toBe(LayoutKind.Radial);
		expect(l.depth).toBe(2);
		expect(l.rootEntityId).toBe("ent_root");
		expect(l.linkDirections).toEqual([EdgeDirection.Both]);
	});

	it("Path → fromEntityId/toEntityId passed through; defaults to Shortest with caps 5/6", () => {
		const l = defaultLayoutForPath("ent_from", "ent_to");
		expect(l.kind).toBe(GraphViewKind.Path);
		expect(l.fromEntityId).toBe("ent_from");
		expect(l.toEntityId).toBe("ent_to");
		expect(l.maxPaths).toBe(5);
		expect(l.maxLength).toBe(6);
		expect(l.algorithm).toBe(PathAlgorithm.Shortest);
	});
});

describe("layoutMatchesViewKind", () => {
	it("accepts a Full view paired with a Full layout", () => {
		expect(
			layoutMatchesViewKind({
				kind: GraphViewKind.Full,
				layoutOptions: defaultLayoutForFull(),
			}),
		).toBe(true);
	});

	it("rejects a Full view paired with a Local layout", () => {
		expect(
			layoutMatchesViewKind({
				kind: GraphViewKind.Full,
				layoutOptions: defaultLayoutForLocal("ent_root"),
			}),
		).toBe(false);
	});

	it("accepts each kind paired with its own layout", () => {
		expect(
			layoutMatchesViewKind({
				kind: GraphViewKind.Local,
				layoutOptions: defaultLayoutForLocal("ent_r"),
			}),
		).toBe(true);
		expect(
			layoutMatchesViewKind({
				kind: GraphViewKind.Path,
				layoutOptions: defaultLayoutForPath("a", "b"),
			}),
		).toBe(true);
	});
});
