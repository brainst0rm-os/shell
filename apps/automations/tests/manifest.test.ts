import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../packages/shell/src/main/apps/manifest";

const MANIFEST_PATH = join(__dirname, "..", "manifest.json");

function readManifest(): unknown {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("apps/automations/manifest.json", () => {
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
		expect(result.manifest.id).toBe("io.brainstorm.automations");
		expect(result.manifest.sdk).toBe("1");
	});

	it("registers Workflow/v1 as the primary opener + intent", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		expect(
			openers.find((op) => op.entityType === "brainstorm/Workflow/v1" && op.kind === "primary"),
		).toBeDefined();
		const intents = result.manifest.registrations?.intents ?? [];
		const open = intents.find((i) => i.verb === "open" && i.entityType === "brainstorm/Workflow/v1");
		expect(open?.priority).toBe("primary");
	});

	it("introduces the four automations types with inline schemas (offline install)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const types = result.manifest.registrations?.entityTypes ?? [];
		for (const id of [
			"brainstorm/Workflow/v1",
			"brainstorm/Trigger/v1",
			"brainstorm/WorkflowRun/v1",
			"brainstorm/Reminder/v1",
		]) {
			const type = types.find((t) => t.id === id);
			expect(type, id).toBeDefined();
			expect(type?.schemaUrl).toMatch(/^https?:\/\//);
			expect(type?.schema).toBeDefined();
		}
	});

	it("declares per-type read/write caps + read:* for cross-app entity reads", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const caps = result.manifest.capabilities;
		for (const type of ["Workflow", "Trigger", "WorkflowRun", "Reminder"]) {
			expect(caps).toContain(`entities.read:brainstorm/${type}/v1`);
			expect(caps).toContain(`entities.write:brainstorm/${type}/v1`);
		}
		expect(caps).toContain("entities.read:*");
		expect(caps).toContain("notifications.post");
	});

	it("requests no AI surface yet (arrives with 11b.7 / Stage 11), but holds the shipped step/transfer caps", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const caps = result.manifest.capabilities;
		expect(caps.some((c) => c.startsWith("ai."))).toBe(false);
		// 11b.8 — the HTTP step ships but holds NO blanket egress grant. A
		// wildcard `network.egress:*` would make the per-origin gate a no-op and
		// turn any user-authored workflow into an exfiltration channel; per-origin
		// egress is granted at runtime through the user-approved allowlist, so the
		// app manifest must carry no egress wildcard (and no egress grant at all).
		expect(caps).not.toContain("network.egress:*");
		expect(caps.some((c) => c.startsWith("network.egress:"))).toBe(false);
		// 11b.16 — bundle import/export rides the Files host.
		expect(caps).toContain("files.read");
		expect(caps).toContain("files.write");
		// 11b.6 — the runNow / host-designation service surface.
		expect(caps).toContain("automations.run");
	});
});
