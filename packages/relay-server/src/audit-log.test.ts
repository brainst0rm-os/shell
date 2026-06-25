/**
 * Stage 10.4 — `AuditLog` unit tests.
 *
 * Pins:
 *   - The recorded `AuditEntry` shape (the 10.9 ciphertext-only proof
 *     consumes this; structural change is load-bearing).
 *   - The type-system fence on `AuditEntryInput` — the audit log MUST
 *     NOT accept a payload-shaped field. Tested by a compile-time-only
 *     assertion: `AuditEntryInput` must not include `payload` /
 *     `ciphertext` keys. (We cannot easily check this at runtime without
 *     dropping the type-system guarantee; instead the runtime test
 *     records the actual entry shape and asserts `keys === expected`.)
 *   - The injected sink receives one stringified entry per `record`.
 */

import { describe, expect, it } from "vitest";
import { type AuditEntry, type AuditEntryInput, AuditLog } from "./audit-log";
import { WireKind } from "./wire";

describe("AuditLog", () => {
	it("records an entry with the expected shape; never includes payload bytes", () => {
		const audit = new AuditLog({ now: () => 1_700_000_000_000 });
		const entry: AuditEntry = audit.record({
			fromConnId: "from",
			toConnId: "to",
			entityId: "ent_1",
			kind: WireKind.Update,
			bytes: 256,
		});
		expect(entry.ts).toBe(1_700_000_000_000);
		expect(Object.keys(entry).sort()).toEqual([
			"bytes",
			"entityId",
			"fromConnId",
			"kind",
			"toConnId",
			"ts",
		]);
		expect(audit.entries().length).toBe(1);
	});

	it("the AuditEntryInput type must not include any payload-shaped field", () => {
		// Compile-time fence: AuditEntryInput's keys are the SAME as the
		// runtime entry keys minus `ts` (which the audit log mints). If a
		// future commit adds a `payload` / `ciphertext` field, this
		// expression fails to type-check.
		const _proof: AuditEntryInput = {
			fromConnId: "f",
			toConnId: "t",
			entityId: "e",
			kind: WireKind.Update,
			bytes: 0,
		};
		// Runtime cross-check: the runtime keys are exactly these + ts.
		const audit = new AuditLog({ now: () => 0 });
		const entry = audit.record(_proof);
		const inputKeys = Object.keys(_proof).sort();
		const entryKeys = Object.keys(entry).sort();
		expect(entryKeys).toEqual([...inputKeys, "ts"].sort());
	});

	it("sink receives one JSON-stringified line per record", () => {
		const lines: string[] = [];
		const audit = new AuditLog({
			sink: (line: string): void => {
				lines.push(line);
			},
			now: () => 1,
		});
		audit.record({
			fromConnId: "a",
			toConnId: "b",
			entityId: "ent_1",
			kind: WireKind.Update,
			bytes: 10,
		});
		audit.record({
			fromConnId: "a",
			toConnId: "c",
			entityId: "ent_1",
			kind: WireKind.WrapBootstrap,
			bytes: 200,
		});
		expect(lines.length).toBe(2);
		expect(JSON.parse(lines[0] ?? "")).toMatchObject({
			fromConnId: "a",
			toConnId: "b",
			entityId: "ent_1",
			kind: WireKind.Update,
			bytes: 10,
		});
		expect(JSON.parse(lines[1] ?? "")).toMatchObject({ kind: WireKind.WrapBootstrap });
	});

	it("toJSONL serialises entries one-per-line + clear resets the log", () => {
		const audit = new AuditLog({ now: () => 0 });
		audit.record({
			fromConnId: "a",
			toConnId: "b",
			entityId: "ent_1",
			kind: WireKind.Update,
			bytes: 1,
		});
		audit.record({
			fromConnId: "a",
			toConnId: "c",
			entityId: "ent_1",
			kind: WireKind.Update,
			bytes: 2,
		});
		const jsonl = audit.toJSONL();
		expect(jsonl.split("\n").length).toBe(2);
		audit.clear();
		expect(audit.entries().length).toBe(0);
	});
});
