/**
 * Coverage for the 9.4.3 block-renderer registry — every observable
 * surface gets at least one fence: lookup order (custom-node before BP
 * before fallback), promise caching, invalidation, fail-soft on
 * throwing resolvers, grammar pre-check, and exact parity with the
 * shell-side block-id grammar.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BlockRendererFallbackReason,
	BlockRendererKind,
	type BpResolver,
	DEFAULT_BUILTIN_CUSTOM_NODES,
	SDK_BLOCK_ID_PATTERN,
	SHELL_ENTITY_CARD_BLOCK_ID,
	createBlockRendererRegistry,
	isStructurallyValidBlockId,
} from "./index";

// Mirror the canonical regex at the shell side
// (`packages/shell/src/main/apps/block-id.ts`). SDK can't import from
// shell (leaf layering), so the parity test lives here as a literal-
// equality guard, and the shell side gets a complementary test in
// `blocks-service.test.ts` that pins the SDK regex value. Two halves
// of the same contract; either flags a unilateral edit.
const SHELL_BLOCK_ID_PATTERN_LITERAL = "^[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+$";

describe("createBlockRendererRegistry — grammar", () => {
	it("SDK grammar regex source matches the shell-side canonical literal", () => {
		expect(SDK_BLOCK_ID_PATTERN.source).toBe(SHELL_BLOCK_ID_PATTERN_LITERAL);
		expect(SDK_BLOCK_ID_PATTERN.flags).toBe("");
	});

	it("isStructurallyValidBlockId behaves as documented on a representative corpus", () => {
		// Each row: [id, expected-validity]. Confirms the single-slash
		// constraint, the no-space rule, and the safe-char alphabet.
		const corpus: Array<readonly [string, boolean]> = [
			["io.brainstorm.shell/entity-card", true],
			["a/b", true],
			["io.brainstorm.notes/embed", true],
			// Two slashes → invalid (the SHELL_ENTITY_CARD_BLOCK_ID has two
			// slashes intentionally — the resolver short-circuits via the
			// custom-node store before any grammar check, so a structurally
			// invalid id is fine as a non-resolvable marker).
			["io.brainstorm.shell/entity-card/v1", false],
			["", false],
			["foo", false],
			["/bar", false],
			["foo/", false],
			["foo bar/baz", false],
			["foo/bar baz", false],
			["foo/<script>", false],
		];
		for (const [id, valid] of corpus) {
			expect(isStructurallyValidBlockId(id)).toBe(valid);
		}
	});

	it("DEFAULT_BUILTIN_CUSTOM_NODES contains the shell entity-card id", () => {
		expect(DEFAULT_BUILTIN_CUSTOM_NODES).toContain(SHELL_ENTITY_CARD_BLOCK_ID);
	});

	it("DEFAULT_BUILTIN_CUSTOM_NODES is frozen — caller mutation can't poison subsequent registries", () => {
		expect(Object.isFrozen(DEFAULT_BUILTIN_CUSTOM_NODES)).toBe(true);
	});
});

describe("createBlockRendererRegistry — lookup order", () => {
	it("custom-node wins over BP — a registered custom-node id never reaches bpResolver", async () => {
		const resolver = vi.fn<BpResolver>();
		const registry = createBlockRendererRegistry({
			bpResolver: resolver,
			builtInCustomNodes: [SHELL_ENTITY_CARD_BLOCK_ID],
		});
		const info = await registry.resolve(SHELL_ENTITY_CARD_BLOCK_ID);
		expect(info.kind).toBe(BlockRendererKind.CustomNode);
		expect(info.blockId).toBe(SHELL_ENTITY_CARD_BLOCK_ID);
		expect(resolver).not.toHaveBeenCalled();
	});

	it("BP wins over fallback — a provider answer surfaces as BlockProtocol", async () => {
		const resolver = vi.fn<BpResolver>().mockResolvedValue({
			appId: "io.brainstorm.tasks",
			name: "list",
		});
		const registry = createBlockRendererRegistry({ bpResolver: resolver });
		const info = await registry.resolve("io.brainstorm.tasks/list");
		expect(info.kind).toBe(BlockRendererKind.BlockProtocol);
		if (info.kind === BlockRendererKind.BlockProtocol) {
			expect(info.appId).toBe("io.brainstorm.tasks");
			expect(info.name).toBe("list");
		}
		expect(resolver).toHaveBeenCalledWith("io.brainstorm.tasks/list");
	});

	it("falls back when no provider answers", async () => {
		const resolver = vi.fn<BpResolver>().mockResolvedValue(null);
		const registry = createBlockRendererRegistry({ bpResolver: resolver });
		const info = await registry.resolve("io.unknown/missing");
		expect(info.kind).toBe(BlockRendererKind.Fallback);
		if (info.kind === BlockRendererKind.Fallback) {
			expect(info.reason).toBe(BlockRendererFallbackReason.NoProvider);
		}
	});

	it("falls back without calling bpResolver when no resolver is provided", async () => {
		const registry = createBlockRendererRegistry({});
		const info = await registry.resolve("io.unknown/missing");
		expect(info.kind).toBe(BlockRendererKind.Fallback);
		if (info.kind === BlockRendererKind.Fallback) {
			expect(info.reason).toBe(BlockRendererFallbackReason.NoProvider);
		}
	});
});

describe("createBlockRendererRegistry — invalid input", () => {
	it("invalid block id resolves to Fallback{reason:Invalid} without touching bpResolver", async () => {
		const resolver = vi.fn<BpResolver>();
		const registry = createBlockRendererRegistry({ bpResolver: resolver });
		for (const bad of ["", "no-slash", "/missing-app", "missing-name/", "with space/x"]) {
			const info = await registry.resolve(bad);
			expect(info.kind).toBe(BlockRendererKind.Fallback);
			if (info.kind === BlockRendererKind.Fallback) {
				expect(info.reason).toBe(BlockRendererFallbackReason.Invalid);
			}
		}
		expect(resolver).not.toHaveBeenCalled();
	});

	it("invalid id is still cached — repeated invalid lookups don't re-validate", async () => {
		const registry = createBlockRendererRegistry({});
		const first = await registry.resolve("bad-id");
		const second = await registry.resolve("bad-id");
		expect(first).toBe(second); // referential equality from cache
	});
});

describe("createBlockRendererRegistry — fail-soft", () => {
	it("bpResolver throw surfaces as Fallback{reason:ResolveError}, not propagation", async () => {
		const resolver = vi.fn<BpResolver>().mockRejectedValue(new Error("Unavailable"));
		const registry = createBlockRendererRegistry({ bpResolver: resolver });
		const info = await registry.resolve("io.brainstorm.notes/embed");
		expect(info.kind).toBe(BlockRendererKind.Fallback);
		if (info.kind === BlockRendererKind.Fallback) {
			expect(info.reason).toBe(BlockRendererFallbackReason.ResolveError);
		}
	});

	it("bpResolver sync throw is also caught and demoted to Fallback", async () => {
		// Even though the type signature says async, a misbehaving impl could
		// throw synchronously before the promise materialises. Cover that too.
		const resolver = vi.fn<BpResolver>().mockImplementation(() => {
			throw new Error("boom");
		});
		const registry = createBlockRendererRegistry({ bpResolver: resolver });
		const info = await registry.resolve("io.brainstorm.notes/embed");
		expect(info.kind).toBe(BlockRendererKind.Fallback);
		if (info.kind === BlockRendererKind.Fallback) {
			expect(info.reason).toBe(BlockRendererFallbackReason.ResolveError);
		}
	});
});

describe("createBlockRendererRegistry — caching", () => {
	let resolver: ReturnType<typeof vi.fn<BpResolver>>;

	beforeEach(() => {
		resolver = vi.fn<BpResolver>().mockResolvedValue({
			appId: "io.brainstorm.tasks",
			name: "list",
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("twenty concurrent resolves of the same id round-trip the resolver exactly once", async () => {
		const registry = createBlockRendererRegistry({ bpResolver: resolver });
		const ids = Array.from({ length: 20 }, () => "io.brainstorm.tasks/list");
		const results = await Promise.all(ids.map((id) => registry.resolve(id)));
		expect(resolver).toHaveBeenCalledTimes(1);
		for (const r of results) expect(r).toBe(results[0]);
	});

	it("invalidate(id) drops only that entry — neighbouring caches survive", async () => {
		const registry = createBlockRendererRegistry({ bpResolver: resolver });
		await registry.resolve("io.brainstorm.tasks/list");
		await registry.resolve("io.brainstorm.tasks/board");
		expect(resolver).toHaveBeenCalledTimes(2);
		registry.invalidate("io.brainstorm.tasks/list");
		await registry.resolve("io.brainstorm.tasks/list");
		await registry.resolve("io.brainstorm.tasks/board"); // cached
		expect(resolver).toHaveBeenCalledTimes(3);
	});

	it("clear() drops everything — every subsequent resolve re-hits the resolver", async () => {
		const registry = createBlockRendererRegistry({ bpResolver: resolver });
		await registry.resolve("io.brainstorm.tasks/list");
		await registry.resolve("io.brainstorm.tasks/board");
		registry.clear();
		await registry.resolve("io.brainstorm.tasks/list");
		await registry.resolve("io.brainstorm.tasks/board");
		expect(resolver).toHaveBeenCalledTimes(4);
	});

	it("registerCustomNode bumps the cached entry — a previously-fallback id flips to CustomNode", async () => {
		// Race scenario: a doc loads, BlockEmbedNode A renders, resolves
		// to Fallback (no provider). Then the host installs a custom node
		// for that id (e.g. a hot-plug from a plugin install). The next
		// render should pick up the new state.
		const id = "io.brainstorm.notes/inline-foo";
		const r = vi.fn<BpResolver>().mockResolvedValue(null);
		const registry = createBlockRendererRegistry({ bpResolver: r });
		const before = await registry.resolve(id);
		expect(before.kind).toBe(BlockRendererKind.Fallback);
		registry.registerCustomNode(id);
		const after = await registry.resolve(id);
		expect(after.kind).toBe(BlockRendererKind.CustomNode);
		expect(r).toHaveBeenCalledTimes(1); // BP resolver not re-asked
	});

	it("unregisterCustomNode bumps the cached entry — a removed custom node falls back to BP", async () => {
		const id = "io.brainstorm.notes/inline-foo";
		const r = vi.fn<BpResolver>().mockResolvedValue({
			appId: "io.brainstorm.notes",
			name: "inline-foo",
		});
		const registry = createBlockRendererRegistry({
			bpResolver: r,
			builtInCustomNodes: [id],
		});
		const before = await registry.resolve(id);
		expect(before.kind).toBe(BlockRendererKind.CustomNode);
		registry.unregisterCustomNode(id);
		const after = await registry.resolve(id);
		expect(after.kind).toBe(BlockRendererKind.BlockProtocol);
	});
});

describe("createBlockRendererRegistry — hasCustomNode", () => {
	it("reports the current state — register / unregister flips it", () => {
		const registry = createBlockRendererRegistry({
			builtInCustomNodes: [SHELL_ENTITY_CARD_BLOCK_ID],
		});
		expect(registry.hasCustomNode(SHELL_ENTITY_CARD_BLOCK_ID)).toBe(true);
		expect(registry.hasCustomNode("foo/bar")).toBe(false);
		registry.registerCustomNode("foo/bar");
		expect(registry.hasCustomNode("foo/bar")).toBe(true);
		registry.unregisterCustomNode("foo/bar");
		expect(registry.hasCustomNode("foo/bar")).toBe(false);
	});
});

describe("createBlockRendererRegistry — registerCustomNode idempotence", () => {
	it("double register is a no-op (no error, no state change)", () => {
		const registry = createBlockRendererRegistry({});
		registry.registerCustomNode("foo/bar");
		registry.registerCustomNode("foo/bar");
		expect(registry.hasCustomNode("foo/bar")).toBe(true);
	});

	it("unregister of an unknown id is a no-op", () => {
		const registry = createBlockRendererRegistry({});
		expect(() => registry.unregisterCustomNode("never/registered")).not.toThrow();
	});
});
