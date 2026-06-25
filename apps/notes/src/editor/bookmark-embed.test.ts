// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it, vi } from "vitest";
import {
	type BookmarkEntities,
	insertBookmarkEmbed,
	resolveOrCreateBookmark,
} from "./bookmark-embed";
import { BOOKMARK_ENTITY_TYPE } from "./bookmark-suggest";
import {
	$isBlockEmbedNode,
	BlockEmbedNode,
	SHELL_ENTITY_CARD_BLOCK_ID,
} from "./nodes/block-embed-node";

type Row = { id: string; properties: Record<string, unknown> };

function fakeEntities(initial: Row[] = []): BookmarkEntities & { rows: Row[] } {
	const rows = [...initial];
	let n = 0;
	return {
		rows,
		async query() {
			return rows;
		},
		async create(_type, properties) {
			const row: Row = { id: `bm_${++n}`, properties: { ...properties } };
			rows.push(row);
			return row;
		},
	};
}

describe("resolveOrCreateBookmark", () => {
	it("creates a new Bookmark/v1 when none matches the URL", async () => {
		const entities = fakeEntities();
		const result = await resolveOrCreateBookmark(entities, "https://example.com/x", () => 42);
		expect(result.created).toBe(true);
		expect(result.label).toBe("example.com");
		expect(entities.rows).toHaveLength(1);
		const created = entities.rows[0];
		expect(created?.properties.url).toBe("https://example.com/x");
		expect(created?.properties.savedAt).toBe(42);
		expect(result.entityId).toBe(created?.id);
	});

	it("reuses an existing bookmark with the same URL (dedupe)", async () => {
		const entities = fakeEntities([
			{ id: "bm_existing", properties: { url: "https://example.com/x", title: "Old Title" } },
		]);
		const result = await resolveOrCreateBookmark(entities, "https://example.com/x", () => 99);
		expect(result.created).toBe(false);
		expect(result.entityId).toBe("bm_existing");
		expect(result.label).toBe("Old Title");
		// No second row minted.
		expect(entities.rows).toHaveLength(1);
	});

	it("queries the Bookmarks-app-owned type", async () => {
		const entities = fakeEntities();
		const querySpy = vi.spyOn(entities, "query");
		await resolveOrCreateBookmark(entities, "https://example.com", () => 0);
		expect(querySpy).toHaveBeenCalledWith({ type: BOOKMARK_ENTITY_TYPE });
	});
});

function editor(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "bookmark-embed",
		nodes: [BlockEmbedNode],
		onError: (e) => {
			throw e;
		},
	});
}

describe("insertBookmarkEmbed", () => {
	it("replaces the target block with a BlockEmbedNode using the resolved block id", async () => {
		const e = editor();
		let key = "";
		e.update(
			() => {
				const p = $createParagraphNode();
				$getRoot().append(p);
				key = p.getKey();
			},
			{ discrete: true },
		);
		const blocks = { forType: vi.fn().mockResolvedValue("io.brainstorm.bookmarks/bookmark") };
		await insertBookmarkEmbed(e, blocks, key, {
			entityId: "bm_1",
			label: "example.com",
			created: true,
		});
		expect(blocks.forType).toHaveBeenCalledWith(BOOKMARK_ENTITY_TYPE);
		e.getEditorState().read(() => {
			const children = $getRoot().getChildren();
			expect(children).toHaveLength(1);
			const child = children[0];
			expect($isBlockEmbedNode(child)).toBe(true);
			if (!$isBlockEmbedNode(child)) return;
			expect(child.getEntityId()).toBe("bm_1");
			expect(child.getEntityType()).toBe(BOOKMARK_ENTITY_TYPE);
			expect(child.getBlockId()).toBe("io.brainstorm.bookmarks/bookmark");
		});
	});

	it("falls back to the shell card when no block id resolves", async () => {
		const e = editor();
		let key = "";
		e.update(
			() => {
				const p = $createParagraphNode();
				$getRoot().append(p);
				key = p.getKey();
			},
			{ discrete: true },
		);
		const blocks = { forType: vi.fn().mockResolvedValue(null) };
		await insertBookmarkEmbed(e, blocks, key, {
			entityId: "bm_2",
			label: "example.com",
			created: true,
		});
		e.getEditorState().read(() => {
			const child = $getRoot().getChildren()[0];
			expect($isBlockEmbedNode(child)).toBe(true);
			if (!$isBlockEmbedNode(child)) return;
			expect(child.getBlockId()).toBe(SHELL_ENTITY_CARD_BLOCK_ID);
		});
	});

	it("falls back to the shell card when the block registry is absent", async () => {
		const e = editor();
		let key = "";
		e.update(
			() => {
				const p = $createParagraphNode();
				$getRoot().append(p);
				key = p.getKey();
			},
			{ discrete: true },
		);
		await insertBookmarkEmbed(e, undefined, key, {
			entityId: "bm_3",
			label: "x",
			created: true,
		});
		e.getEditorState().read(() => {
			const child = $getRoot().getChildren()[0];
			expect($isBlockEmbedNode(child)).toBe(true);
		});
	});
});
