// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { $createAudioBlockNode, $isAudioBlockNode, AudioBlockNode } from "./nodes/audio-block-node";
import {
	$createFileBlockNode,
	$isFileBlockNode,
	FileBlockNode,
	formatBytes,
} from "./nodes/file-block-node";
import { MediaFileKind, classifyMediaFile, collectMediaFiles, resolveBinarySrc } from "./upload";

function file(name: string, type: string, bytes = 8): File {
	return new File([new Uint8Array(bytes)], name, { type });
}

describe("classifyMediaFile", () => {
	it("routes by MIME prefix, defaulting to File", () => {
		expect(classifyMediaFile(file("a.png", "image/png"))).toBe(MediaFileKind.Image);
		expect(classifyMediaFile(file("a.mp4", "video/mp4"))).toBe(MediaFileKind.Video);
		expect(classifyMediaFile(file("a.mp3", "audio/mpeg"))).toBe(MediaFileKind.Audio);
		expect(classifyMediaFile(file("a.zip", "application/zip"))).toBe(MediaFileKind.File);
		expect(classifyMediaFile(file("a", ""))).toBe(MediaFileKind.File);
	});
});

describe("collectMediaFiles", () => {
	it("accepts every file now (image/video/audio/other)", () => {
		const files = [file("a.png", "image/png"), file("b.zip", "application/zip")];
		const list = Object.assign(files, {
			item: (i: number) => files[i] ?? null,
		}) as unknown as FileList;
		expect(collectMediaFiles(list)).toHaveLength(2);
		expect(collectMediaFiles(null)).toEqual([]);
	});
});

describe("formatBytes", () => {
	it("formats binary sizes", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
		expect(formatBytes(1024 * 1024 * 20)).toBe("20 MB");
		expect(formatBytes(-1)).toBe("");
	});
});

describe("resolveBinarySrc", () => {
	it("falls back to a data URL when no upload host is present and under the cap", async () => {
		const src = await resolveBinarySrc(file("note.txt", "text/plain", 4));
		expect(src).toMatch(/^data:/);
	});

	it("bails (null) for an oversized file with no upload host", async () => {
		const big = new File([new Uint8Array(1024 * 1024 * 3)], "big.bin", {
			type: "application/octet-stream",
		});
		expect(await resolveBinarySrc(big)).toBeNull();
	});
});

function editor(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "m",
		nodes: [AudioBlockNode, FileBlockNode],
		onError: (e) => {
			throw e;
		},
	});
}

describe("audio / file node round-trip", () => {
	it("AudioBlockNode preserves src/mime/name", () => {
		const e = editor();
		e.update(
			() => {
				$getRoot().append($createAudioBlockNode("brainstorm://f/1", "audio/mpeg", "song.mp3"));
			},
			{ discrete: true },
		);
		const json = JSON.stringify(e.getEditorState().toJSON());
		const next = editor();
		next.setEditorState(next.parseEditorState(json));
		next.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			expect($isAudioBlockNode(n)).toBe(true);
			if ($isAudioBlockNode(n)) {
				expect(n.exportJSON()).toMatchObject({
					type: "audio-block",
					src: "brainstorm://f/1",
					mime: "audio/mpeg",
					name: "song.mp3",
				});
			}
		});
	});

	it("FileBlockNode preserves src/name/size/mime", () => {
		const e = editor();
		e.update(
			() => {
				$getRoot().append(
					$createFileBlockNode("brainstorm://f/2", "report.pdf", 2048, "application/pdf"),
				);
			},
			{ discrete: true },
		);
		const json = JSON.stringify(e.getEditorState().toJSON());
		const next = editor();
		next.setEditorState(next.parseEditorState(json));
		next.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			expect($isFileBlockNode(n)).toBe(true);
			if ($isFileBlockNode(n)) {
				expect(n.exportJSON()).toMatchObject({
					type: "file-block",
					name: "report.pdf",
					size: 2048,
				});
			}
		});
	});
});
