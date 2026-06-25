import { describe, expect, it } from "vitest";
import { ArrowHead, EdgePathKind, HandleSide } from "../types/edge";
import {
	FontFamily,
	ImageFit,
	NodeKind,
	STICKY_COLORS,
	ShapeKind,
	StickyColor,
	TEXT_BLOCK_FORMATS,
	TextBlockFormat,
	TextColor,
	TextSize,
	type WhiteboardNode,
	isFrame,
	isGroup,
	isImage,
	isInk,
	isShape,
	isSticky,
	isText,
} from "../types/node";
import {
	EDGE_KEY_PREFIX,
	WHITEBOARD_KEY_PREFIX,
	edgeKey,
	parseStoredEdge,
	parseStoredWhiteboard,
	serializeWhiteboard,
	whiteboardKey,
} from "./codec";

const BASE_WB = {
	id: "wb1",
	name: "Board",
	nodes: [],
	createdAt: 1700000000000,
	updatedAt: 1700000000000,
};

const BASE_NODE = {
	id: "n1",
	kind: NodeKind.Sticky,
	x: 10,
	y: 20,
	width: 100,
	height: 50,
};

const BASE_EDGE = {
	id: "e1",
	whiteboardId: "wb1",
	sourceNodeId: "n1",
	sourceHandle: HandleSide.Right,
	destNodeId: "n2",
	destHandle: HandleSide.Left,
	pathKind: EdgePathKind.Bezier,
	arrowHead: ArrowHead.Arrow,
	label: null,
	colorHint: null,
	createdAt: 1700000000000,
	updatedAt: 1700000000000,
};

describe("storage keys", () => {
	it("uses stable prefixes", () => {
		expect(WHITEBOARD_KEY_PREFIX).toBe("whiteboard:");
		expect(EDGE_KEY_PREFIX).toBe("whiteboard-edge:");
		expect(whiteboardKey("abc")).toBe("whiteboard:abc");
		expect(edgeKey("abc")).toBe("whiteboard-edge:abc");
	});
});

describe("parseStoredWhiteboard", () => {
	it("returns null for non-objects + missing required fields", () => {
		expect(parseStoredWhiteboard(null)).toBeNull();
		expect(parseStoredWhiteboard("string")).toBeNull();
		expect(parseStoredWhiteboard({ ...BASE_WB, id: "" })).toBeNull();
		expect(parseStoredWhiteboard({ ...BASE_WB, name: 42 })).toBeNull();
		expect(parseStoredWhiteboard({ ...BASE_WB, createdAt: "now" })).toBeNull();
	});

	it("returns an empty node list when nodes is missing", () => {
		const out = parseStoredWhiteboard({ ...BASE_WB });
		expect(out?.nodes).toEqual([]);
	});

	it("drops malformed nodes from the inline array, keeps the rest", () => {
		const out = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [
				BASE_NODE,
				{ ...BASE_NODE, id: "n2", kind: "made-up" }, // unknown kind → drop
				{ ...BASE_NODE, id: "n3", width: -5 }, // non-positive → drop
				{ ...BASE_NODE, id: "n4" },
			],
		});
		expect(out?.nodes.map((n) => n.id)).toEqual(["n1", "n4"]);
	});

	it("preserves description when supplied", () => {
		const out = parseStoredWhiteboard({ ...BASE_WB, description: "A demo board" });
		expect(out?.description).toBe("A demo board");
	});

	it("drops description when wrong-typed", () => {
		const out = parseStoredWhiteboard({ ...BASE_WB, description: 42 });
		expect(out?.description).toBeUndefined();
	});

	it("preserves shared optional fields (zIndex) + per-kind payload", () => {
		const out = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, text: "Hello", color: StickyColor.Blue, zIndex: 3 }],
		});
		const node = out?.nodes[0];
		expect(node && isSticky(node) && node.text).toBe("Hello");
		expect(node && isSticky(node) && node.color).toBe(StickyColor.Blue);
		expect(node?.zIndex).toBe(3);
	});

	it("round-trips a Shape node (9.17.10), defaulting a bad shape/color", () => {
		const ok = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, kind: NodeKind.Shape, shape: "ellipse", color: StickyColor.Pink }],
		})?.nodes[0];
		expect(ok && isShape(ok) && ok.shape).toBe(ShapeKind.Ellipse);
		expect(ok && isShape(ok) && ok.color).toBe(StickyColor.Pink);
		const fallback = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, kind: NodeKind.Shape, shape: "hexagon" }],
		})?.nodes[0];
		expect(fallback && isShape(fallback) && fallback.shape).toBe(ShapeKind.Rectangle);
	});

	it("round-trips the SVG shape kinds (triangle / diamond / line / arrow)", () => {
		for (const shape of [ShapeKind.Triangle, ShapeKind.Diamond, ShapeKind.Line, ShapeKind.Arrow]) {
			const out = parseStoredWhiteboard({
				...BASE_WB,
				nodes: [{ ...BASE_NODE, kind: NodeKind.Shape, shape, color: StickyColor.Blue }],
			})?.nodes[0];
			expect(out && isShape(out) && out.shape).toBe(shape);
		}
	});

	it("round-trips an Ink node (9.17.9) and drops one with too few points", () => {
		const ok = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [
				{
					...BASE_NODE,
					kind: NodeKind.Ink,
					points: [
						{ x: 0, y: 0 },
						{ x: 50, y: 50 },
					],
					color: StickyColor.Purple,
				},
			],
		})?.nodes[0];
		expect(ok && isInk(ok) && ok.points.length).toBe(2);
		expect(ok && isInk(ok) && ok.color).toBe(StickyColor.Purple);
		// A stroke with <2 valid points can't render → the node is dropped.
		const dropped = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, kind: NodeKind.Ink, points: [{ x: 1, y: 1 }] }],
		})?.nodes;
		expect(dropped).toEqual([]);
	});

	it("preserves locked=true and omits a falsy/absent lock (9.17.15)", () => {
		const locked = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, locked: true }],
		})?.nodes[0];
		expect(locked?.locked).toBe(true);
		const unlocked = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, locked: false }],
		})?.nodes[0];
		expect(unlocked?.locked).toBeUndefined();
		const absent = parseStoredWhiteboard({ ...BASE_WB, nodes: [{ ...BASE_NODE }] })?.nodes[0];
		expect(absent?.locked).toBeUndefined();
	});

	it("preserves a valid textSize on sticky/text and omits bad/absent ones (9.17.12)", () => {
		const sticky = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, textSize: TextSize.Large }],
		})?.nodes[0];
		expect(sticky && isSticky(sticky) && sticky.textSize).toBe(TextSize.Large);

		const text = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, kind: NodeKind.Text, text: "p", textSize: "huge" }],
		})?.nodes[0];
		// Unknown size is dropped (left absent → renders at the default).
		expect(text && isText(text) && text.textSize).toBeUndefined();

		const absent = parseStoredWhiteboard({ ...BASE_WB, nodes: [{ ...BASE_NODE }] })?.nodes[0];
		expect(absent && isSticky(absent) && absent.textSize).toBeUndefined();
	});

	it("preserves a valid textColor / fontFamily and omits default/bad/absent (9.17.12)", () => {
		const styled = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, textColor: "blue", fontFamily: "mono" }],
		})?.nodes[0];
		expect(styled && isSticky(styled) && styled.textColor).toBe(TextColor.Blue);
		expect(styled && isSticky(styled) && styled.fontFamily).toBe(FontFamily.Mono);

		// Default colour + Sans font are the absent states — omitted on read.
		const def = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, textColor: "default", fontFamily: "sans" }],
		})?.nodes[0];
		expect(def && isSticky(def) && def.textColor).toBeUndefined();
		expect(def && isSticky(def) && def.fontFamily).toBeUndefined();

		// Unknown values drop rather than crash.
		const bad = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, textColor: "chartreuse", fontFamily: "comic" }],
		})?.nodes[0];
		expect(bad && isSticky(bad) && bad.textColor).toBeUndefined();
		expect(bad && isSticky(bad) && bad.fontFamily).toBeUndefined();
	});

	it("preserves bold / italic flags and omits absent/falsey ones (9.17.12)", () => {
		const styled = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, bold: true, italic: true }],
		})?.nodes[0];
		expect(styled && isSticky(styled) && styled.bold).toBe(true);
		expect(styled && isSticky(styled) && styled.italic).toBe(true);

		// Absent + explicit false are the normal states — omitted on read.
		const absent = parseStoredWhiteboard({ ...BASE_WB, nodes: [{ ...BASE_NODE }] })?.nodes[0];
		expect(absent && isSticky(absent) && absent.bold).toBeUndefined();

		const off = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, bold: false, italic: "yes" }],
		})?.nodes[0];
		expect(off && isSticky(off) && off.bold).toBeUndefined();
		// Non-boolean truthy isn't accepted (strict === true).
		expect(off && isSticky(off) && off.italic).toBeUndefined();
	});

	it("round-trips rich runs and recomputes the plain text mirror (9.17.12 rest)", () => {
		const rich = [{ text: "Hello " }, { text: "world", bold: true, color: TextColor.Blue }];
		const wb = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, text: "stale mirror", rich }],
		});
		const sticky = wb?.nodes[0];
		expect(sticky && isSticky(sticky) && sticky.rich).toEqual(rich);
		// The plain mirror self-heals from the runs.
		expect(sticky && isSticky(sticky) && sticky.text).toBe("Hello world");
		// Serialize → parse keeps the runs byte-stable.
		const again = wb && parseStoredWhiteboard(serializeWhiteboard(wb))?.nodes[0];
		expect(again && isSticky(again) && again.rich).toEqual(rich);
	});

	it("omits unstyled / bad / absent rich and keeps the plain text (9.17.12 rest)", () => {
		const unstyled = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, text: "plain", rich: [{ text: "plain" }] }],
		})?.nodes[0];
		expect(unstyled && isSticky(unstyled) && unstyled.rich).toBeUndefined();
		expect(unstyled && isSticky(unstyled) && unstyled.text).toBe("plain");

		const bad = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ ...BASE_NODE, kind: NodeKind.Text, text: "p", rich: "nope" }],
		})?.nodes[0];
		expect(bad && isText(bad) && bad.rich).toBeUndefined();
		expect(bad && isText(bad) && bad.text).toBe("p");
	});
});

const STICKY = { ...BASE_NODE, kind: NodeKind.Sticky, text: "note", color: StickyColor.Green };
const TEXT = {
	id: "t1",
	kind: NodeKind.Text,
	x: 5,
	y: 6,
	width: 30,
	height: 20,
	text: "para",
	format: TextBlockFormat.Quote,
};
const IMAGE = {
	id: "i1",
	kind: NodeKind.Image,
	x: 1,
	y: 2,
	width: 40,
	height: 40,
	imageUrl: "blob:x",
	fit: ImageFit.Cover,
	alt: "a photo",
};
const FRAME = {
	id: "f1",
	kind: NodeKind.Frame,
	x: 0,
	y: 0,
	width: 200,
	height: 200,
	title: "Section",
	colorHint: null,
};
const GROUP = {
	id: "g1",
	kind: NodeKind.Group,
	x: 0,
	y: 0,
	width: 10,
	height: 10,
	memberIds: ["a", "b"],
	colorHint: "#123456",
};

function roundTrip(node: Record<string, unknown>): WhiteboardNode | undefined {
	const wb = serializeWhiteboard({
		...BASE_WB,
		nodes: [node as unknown as WhiteboardNode],
	} as never);
	return parseStoredWhiteboard(wb)?.nodes[0];
}

describe("per-kind round-trip (serialize → parse, deep equal)", () => {
	it("Sticky keeps text + color", () => {
		const out = roundTrip(STICKY);
		expect(out).toEqual(STICKY);
		expect(out && isSticky(out)).toBe(true);
	});

	it("Text keeps text + format", () => {
		const out = roundTrip(TEXT);
		expect(out).toEqual(TEXT);
		expect(out && isText(out)).toBe(true);
	});

	it("Image keeps imageUrl + fit + alt", () => {
		const out = roundTrip(IMAGE);
		expect(out).toEqual(IMAGE);
		expect(out && isImage(out)).toBe(true);
	});

	it("Frame keeps title + colorHint", () => {
		const out = roundTrip(FRAME);
		expect(out).toEqual(FRAME);
		expect(out && isFrame(out)).toBe(true);
	});

	it("Group keeps memberIds + colorHint", () => {
		const out = roundTrip(GROUP);
		expect(out).toEqual(GROUP);
		expect(out && isGroup(out)).toBe(true);
	});
});

describe("legacy read-migration", () => {
	it("Frame: legacy title-in-`text` migrates to `title`", () => {
		const out = roundTrip({
			id: "f9",
			kind: NodeKind.Frame,
			x: 0,
			y: 0,
			width: 50,
			height: 50,
			text: "Old title",
		});
		expect(out && isFrame(out) && out.title).toBe("Old title");
	});

	it("Sticky: legacy `colorHint`-only hex maps to a StickyColor", () => {
		const out = roundTrip({
			...BASE_NODE,
			kind: NodeKind.Sticky,
			text: "x",
			colorHint: "#a3d9a5",
		});
		expect(out && isSticky(out) && out.color).toBe(StickyColor.Green);
	});

	it("Sticky: unrecognised colorHint falls back to Yellow (never null)", () => {
		const out = roundTrip({
			...BASE_NODE,
			kind: NodeKind.Sticky,
			text: "x",
			colorHint: "rebeccapurple",
		});
		expect(out && isSticky(out) && out.color).toBe(StickyColor.Yellow);
	});

	it("Group: missing memberIds becomes []", () => {
		const out = roundTrip({
			id: "g9",
			kind: NodeKind.Group,
			x: 0,
			y: 0,
			width: 10,
			height: 10,
		});
		expect(out && isGroup(out) && out.memberIds).toEqual([]);
	});

	it("Group: non-string members are filtered out", () => {
		const out = roundTrip({
			id: "g8",
			kind: NodeKind.Group,
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			memberIds: ["a", 1, null, "b"],
		});
		expect(out && isGroup(out) && out.memberIds).toEqual(["a", "b"]);
	});
});

describe("malformed per-kind", () => {
	it("Image: non-string imageUrl → node dropped to null", () => {
		const wb = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ id: "i9", kind: NodeKind.Image, x: 0, y: 0, width: 10, height: 10, imageUrl: 42 }],
		});
		expect(wb?.nodes).toEqual([]);
	});

	it("Embedded: missing entityRef → node dropped to null", () => {
		const wb = parseStoredWhiteboard({
			...BASE_WB,
			nodes: [{ id: "x9", kind: NodeKind.Embedded, x: 0, y: 0, width: 10, height: 10 }],
		});
		expect(wb?.nodes).toEqual([]);
	});

	it("Sticky: bogus color falls back, node survives", () => {
		const out = roundTrip({
			...BASE_NODE,
			kind: NodeKind.Sticky,
			text: "x",
			color: "chartreuse",
		});
		expect(out && isSticky(out) && out.color).toBe(StickyColor.Yellow);
	});

	it("Text: bogus format falls back to Plain", () => {
		const out = roundTrip({
			id: "t9",
			kind: NodeKind.Text,
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			text: "x",
			format: "bold",
		});
		expect(out && isText(out) && out.format).toBe(TextBlockFormat.Plain);
	});

	it("Image: bogus fit falls back to Contain", () => {
		const out = roundTrip({
			id: "i8",
			kind: NodeKind.Image,
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			imageUrl: "u",
			fit: "stretch",
		});
		expect(out && isImage(out) && out.fit).toBe(ImageFit.Contain);
	});
});

describe("property: a random valid node of each kind survives round-trip", () => {
	const rng = (seed: number) => {
		let s = seed;
		return () => {
			s = (s * 1664525 + 1013904223) >>> 0;
			return s / 0xffffffff;
		};
	};
	const r = rng(0xc0ffee);
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
	const num = () => Math.floor(r() * 2000) - 500;
	const dim = () => 1 + Math.floor(r() * 1000);

	it("100 random nodes per kind deep-equal after serialize → parse", () => {
		for (const kind of Object.values(NodeKind)) {
			for (let i = 0; i < 100; i++) {
				const id = `p-${kind}-${i}`;
				const box = { id, x: num(), y: num(), width: dim(), height: dim() };
				let node: Record<string, unknown>;
				switch (kind) {
					case NodeKind.Sticky:
						node = { ...box, kind, text: `s${i}`, color: pick(STICKY_COLORS) };
						break;
					case NodeKind.Text:
						node = { ...box, kind, text: `t${i}`, format: pick(TEXT_BLOCK_FORMATS) };
						break;
					case NodeKind.Image:
						node = { ...box, kind, imageUrl: `u${i}`, fit: pick([ImageFit.Contain, ImageFit.Cover]) };
						break;
					case NodeKind.Frame:
						node = { ...box, kind, title: `f${i}`, colorHint: null };
						break;
					case NodeKind.Group:
						node = { ...box, kind, memberIds: [`m${i}`], colorHint: null };
						break;
					default:
						node = { ...box, kind: NodeKind.Embedded, entityRef: `brainstorm://e${i}` };
				}
				expect(roundTrip(node)).toEqual(node);
			}
		}
	});
});

describe("parseStoredEdge", () => {
	it("returns null for non-objects + missing required fields", () => {
		expect(parseStoredEdge(null)).toBeNull();
		expect(parseStoredEdge({ ...BASE_EDGE, id: "" })).toBeNull();
		expect(parseStoredEdge({ ...BASE_EDGE, whiteboardId: "" })).toBeNull();
		expect(parseStoredEdge({ ...BASE_EDGE, sourceNodeId: 42 })).toBeNull();
		expect(parseStoredEdge({ ...BASE_EDGE, destNodeId: null })).toBeNull();
	});

	it("rejects unknown enum values", () => {
		expect(parseStoredEdge({ ...BASE_EDGE, sourceHandle: "northeast" })).toBeNull();
		expect(parseStoredEdge({ ...BASE_EDGE, pathKind: "loop" })).toBeNull();
		expect(parseStoredEdge({ ...BASE_EDGE, arrowHead: "triple" })).toBeNull();
	});

	it("accepts all valid enum values", () => {
		expect(parseStoredEdge({ ...BASE_EDGE, pathKind: EdgePathKind.Step })).not.toBeNull();
		expect(parseStoredEdge({ ...BASE_EDGE, arrowHead: ArrowHead.None })).not.toBeNull();
		expect(parseStoredEdge({ ...BASE_EDGE, sourceHandle: HandleSide.Top })).not.toBeNull();
	});

	it("coerces nullable label + colorHint safely", () => {
		const out = parseStoredEdge({
			...BASE_EDGE,
			label: "writes",
			colorHint: 42,
		});
		expect(out?.label).toBe("writes");
		expect(out?.colorHint).toBeNull();
	});

	it("round-trips a source arrowhead + dashed flag (9.17.16)", () => {
		const out = parseStoredEdge({
			...BASE_EDGE,
			sourceArrowHead: ArrowHead.Diamond,
			dashed: true,
		});
		expect(out?.sourceArrowHead).toBe(ArrowHead.Diamond);
		expect(out?.dashed).toBe(true);
	});

	it("omits a None / absent source arrowhead + a falsy dashed flag", () => {
		const none = parseStoredEdge({ ...BASE_EDGE, sourceArrowHead: ArrowHead.None, dashed: false });
		expect("sourceArrowHead" in (none as object)).toBe(false);
		expect("dashed" in (none as object)).toBe(false);
		// Absent keys (legacy rows) likewise don't appear.
		const bare = parseStoredEdge({ ...BASE_EDGE });
		expect("sourceArrowHead" in (bare as object)).toBe(false);
		expect("dashed" in (bare as object)).toBe(false);
	});

	it("drops an unparseable source arrowhead rather than failing the edge", () => {
		const out = parseStoredEdge({ ...BASE_EDGE, sourceArrowHead: "triple" });
		expect(out).not.toBeNull();
		expect("sourceArrowHead" in (out as object)).toBe(false);
	});
});
