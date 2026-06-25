import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../packages/shell/src/main/apps/manifest";

const MANIFEST_PATH = join(__dirname, "..", "manifest.json");

function readManifest(): unknown {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("apps/calendar/manifest.json", () => {
	it("passes the shell's manifest validator", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) {
			throw new Error(`manifest invalid at ${result.path}: ${result.reason}`);
		}
		expect(result.ok).toBe(true);
	});

	it("declares the expected app id + sdk pin", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.id).toBe("io.brainstorm.calendar");
		expect(result.manifest.sdk).toBe("1");
	});

	it("registers Event/v1 + CalendarView/v1 as primary openers so intent.open routes here", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		expect(
			openers.find((op) => op.entityType === "brainstorm/Event/v1" && op.kind === "primary"),
		).toBeDefined();
		expect(
			openers.find((op) => op.entityType === "brainstorm/CalendarView/v1" && op.kind === "primary"),
		).toBeDefined();
	});

	it("introduces Event/v1 + CalendarView/v1 with inline schemas (offline install)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const types = result.manifest.registrations?.entityTypes ?? [];
		const event = types.find((t) => t.id === "brainstorm/Event/v1");
		const view = types.find((t) => t.id === "brainstorm/CalendarView/v1");
		expect(event).toBeDefined();
		expect(event?.schemaUrl).toMatch(/^https?:\/\//);
		expect(event?.schema).toBeDefined();
		expect(view).toBeDefined();
		expect(view?.schemaUrl).toMatch(/^https?:\/\//);
		expect(view?.schema).toBeDefined();
	});

	it("declares the inline-event BP block id under io.brainstorm.calendar/", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const blocks = result.manifest.registrations?.blocks ?? [];
		const block = blocks.find((b) => b.id === "io.brainstorm.calendar/inline-event");
		expect(block).toBeDefined();
	});

	it("registers open + compose + quick-look intents on Event/v1 as primary", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const open = intents.find((i) => i.verb === "open" && i.entityType === "brainstorm/Event/v1");
		const compose = intents.find(
			(i) => i.verb === "compose" && i.entityType === "brainstorm/Event/v1",
		);
		const quickLook = intents.find(
			(i) => i.verb === "quick-look" && i.entityType === "brainstorm/Event/v1",
		);
		expect(open?.priority).toBe("primary");
		expect(compose?.priority).toBe("primary");
		expect(quickLook?.priority).toBe("primary");
	});

	it("declares the per-type narrow caps + the inline-event block.provide cap + entities.read:* for cross-app sourcing", () => {
		// `entities.read:*` is the cross-app capability that lets Calendar
		// surface Tasks (`scheduledAt`), Notes (date properties), and
		// Person birthdays alongside its own Events. Narrow per-type caps
		// stay so Settings → Security can revoke them individually.
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("entities.read:*");
		expect(result.manifest.capabilities).toContain("entities.read:brainstorm/Event/v1");
		expect(result.manifest.capabilities).toContain("entities.write:brainstorm/Event/v1");
		expect(result.manifest.capabilities).toContain(
			"blocks.provide:io.brainstorm.calendar/inline-event",
		);
		expect(result.manifest.capabilities).toContain("properties.read");
		expect(result.manifest.capabilities).toContain("properties.write");
	});
});
