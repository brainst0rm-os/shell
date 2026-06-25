#!/usr/bin/env bun
// Quick read-only dump of a .ydoc file — load it via the shell's file format
// and print the XmlText "root" structure so we can see what's actually inside.

import { readFileSync } from "node:fs";
import * as Y from "yjs";

const path = process.argv[2];
if (!path) {
	console.error("usage: peek-ydoc.mjs <file.ydoc>");
	process.exit(1);
}

const buf = readFileSync(path);
const magic = buf.subarray(0, 4).toString("ascii");
if (magic !== "YDOC") {
	console.error("bad magic:", magic);
	process.exit(1);
}
const version = buf.readUInt32LE(4);
const snapLen = buf.readUInt32LE(8);
console.log(`magic=YDOC version=${version} snap_len=${snapLen} total=${buf.length}`);

const doc = new Y.Doc();
if (snapLen > 0) {
	const snapshot = buf.subarray(12, 12 + snapLen);
	Y.applyUpdate(doc, snapshot);
	console.log(`applied snapshot (${snapLen} bytes)`);
}
let p = 12 + snapLen;
let entries = 0;
while (p < buf.length) {
	if (p + 4 > buf.length) {
		console.log(`truncated len header at ${p}`);
		break;
	}
	const updLen = buf.readUInt32LE(p);
	p += 4;
	if (p + updLen + 4 > buf.length) {
		console.log(`truncated entry data at ${p}, len=${updLen}`);
		break;
	}
	const update = buf.subarray(p, p + updLen);
	p += updLen;
	const crcStored = buf.readUInt32LE(p);
	p += 4;
	try {
		Y.applyUpdate(doc, update);
		entries += 1;
		console.log(`tail #${entries}: ${updLen}b applied (crc=${crcStored.toString(16)})`);
	} catch (e) {
		console.log(`tail #${entries + 1} (${updLen}b) FAILED:`, e.message);
	}
}

const root = doc.get("root", Y.XmlText);
console.log("\n--- root XmlText length:", root.length);
console.log(`--- root toString():\n${root.toString()}`);
console.log("\n--- root toJSON:");
console.log(JSON.stringify(root.toDelta?.() ?? root.toJSON?.(), null, 2));
