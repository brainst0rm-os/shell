import { describe, expect, it } from "vitest";
import type { Envelope } from "../../ipc/envelope";
import { ShortcutRegistry } from "./shortcut-registry";
import { makeShortcutsServiceHandler } from "./shortcuts-service";

function makeEnv(method: string, args: unknown[], appId = "io.example.app"): Envelope {
	return {
		v: 1,
		msg: "test-msg",
		app: appId,
		service: "shortcuts",
		method,
		args,
		caps: ["shortcuts.register"],
	};
}

function setup(): {
	registry: ShortcutRegistry;
	handle: ReturnType<typeof makeShortcutsServiceHandler>;
} {
	const registry = new ShortcutRegistry();
	const handle = makeShortcutsServiceHandler({ getRegistry: () => registry });
	return { registry, handle };
}

describe("shortcuts service handler — register (6.10c)", () => {
	it("namespaces the dynamic shortcut under the envelope appId", async () => {
		const { registry, handle } = setup();
		await handle(
			makeEnv("register", [{ additions: [{ id: "save", default: "Mod+S", label: "Save" }] }]),
		);
		const resolved = registry.resolve("io.example.app/save");
		expect(resolved?.action.dynamic).toBe(true);
		expect(resolved?.action.appId).toBe("io.example.app");
	});

	it("envelope appId is the only source of truth (caller can't spoof appId)", async () => {
		const { registry, handle } = setup();
		await handle(
			makeEnv(
				"register",
				[{ additions: [{ id: "save", default: "Mod+S", label: "Save" }] }],
				"caller-app",
			),
		);
		// Even if the additions contained a fictitious appId field, the
		// namespace comes from the envelope; no smuggling possible.
		expect(registry.resolve("caller-app/save")).not.toBeNull();
		expect(registry.resolve("victim-app/save")).toBeNull();
	});

	it("rejects an id containing '/' (cross-namespace smuggling defense)", async () => {
		const { handle } = setup();
		await expect(
			handle(
				makeEnv("register", [{ additions: [{ id: "shell/launcher", default: "Mod+P", label: "P" }] }]),
			),
		).rejects.toMatchObject({ name: "Invalid" });
	});

	it("rejects malformed additions shape", async () => {
		const { handle } = setup();
		await expect(handle(makeEnv("register", [{ additions: "nope" }]))).rejects.toMatchObject({
			name: "Invalid",
		});
		await expect(
			handle(makeEnv("register", [{ additions: [{ id: "x", default: "Mod+S" }] }])),
		).rejects.toMatchObject({ name: "Invalid" }); // label missing
		await expect(
			handle(
				makeEnv("register", [
					{ additions: [{ id: "x", default: "Mod+S", label: "L", shadowsShell: "yes" }] },
				]),
			),
		).rejects.toMatchObject({ name: "Invalid" });
	});

	it("a second register call with the same id replaces the prior dynamic binding", async () => {
		const { registry, handle } = setup();
		await handle(
			makeEnv("register", [{ additions: [{ id: "save", default: "Mod+S", label: "v1" }] }]),
		);
		await handle(
			makeEnv("register", [{ additions: [{ id: "save", default: "Mod+Shift+S", label: "v2" }] }]),
		);
		expect(registry.resolve("io.example.app/save")?.chord).toBe("Mod+Shift+S");
	});
});

describe("shortcuts service handler — unregister (6.10c)", () => {
	it("removes the named ids, idempotent on unknown ids", async () => {
		const { registry, handle } = setup();
		await handle(
			makeEnv("register", [
				{
					additions: [
						{ id: "save", default: "Mod+S", label: "Save" },
						{ id: "find", default: "Mod+F", label: "Find" },
					],
				},
			]),
		);
		await handle(makeEnv("unregister", [{ ids: ["save", "nonexistent"] }]));
		expect(registry.resolve("io.example.app/save")).toBeNull();
		expect(registry.resolve("io.example.app/find")).not.toBeNull();
	});

	it("rejects non-array ids", async () => {
		const { handle } = setup();
		await expect(handle(makeEnv("unregister", [{ ids: "save" }]))).rejects.toMatchObject({
			name: "Invalid",
		});
	});

	it("an id with '/' is rejected (cross-namespace smuggling defense)", async () => {
		const { handle } = setup();
		await expect(handle(makeEnv("unregister", [{ ids: ["other.app/save"] }]))).rejects.toMatchObject({
			name: "Invalid",
		});
	});

	it("an app cannot unregister another app's shortcuts via the broker", async () => {
		const { registry, handle } = setup();
		// Register under one appId.
		await handle(
			makeEnv(
				"register",
				[{ additions: [{ id: "save", default: "Mod+S", label: "Save" }] }],
				"victim.app",
			),
		);
		// A different app tries to unregister it.
		await handle(makeEnv("unregister", [{ ids: ["save"] }], "attacker.app"));
		expect(registry.resolve("victim.app/save")).not.toBeNull();
	});
});

describe("shortcuts service handler — setActiveScope (6.10c)", () => {
	it("records the active scope keyed by envelope appId", async () => {
		const { registry, handle } = setup();
		await handle(makeEnv("setActiveScope", [{ scope: "editor" }]));
		expect(registry.getActiveScope("io.example.app")).toBe("editor");
	});

	it("null clears the active scope", async () => {
		const { registry, handle } = setup();
		await handle(makeEnv("setActiveScope", [{ scope: "editor" }]));
		await handle(makeEnv("setActiveScope", [{ scope: null }]));
		expect(registry.getActiveScope("io.example.app")).toBeNull();
	});

	it("rejects non-string non-null scope + empty-string scope", async () => {
		const { handle } = setup();
		await expect(handle(makeEnv("setActiveScope", [{ scope: 42 }]))).rejects.toMatchObject({
			name: "Invalid",
		});
		await expect(handle(makeEnv("setActiveScope", [{ scope: "" }]))).rejects.toMatchObject({
			name: "Invalid",
		});
	});
});

describe("shortcuts service handler — generic errors", () => {
	it("rejects an unknown method", async () => {
		const { handle } = setup();
		await expect(handle(makeEnv("bogus", [{}]))).rejects.toMatchObject({ name: "Invalid" });
	});

	it("Unavailable when the registry accessor returns null", async () => {
		const handle = makeShortcutsServiceHandler({ getRegistry: () => null });
		await expect(
			handle(makeEnv("register", [{ additions: [{ id: "x", default: "Mod+S", label: "X" }] }])),
		).rejects.toMatchObject({ name: "Unavailable" });
	});

	it("rejects an envelope without an appId", async () => {
		const { handle } = setup();
		const env = makeEnv("register", [{ additions: [{ id: "x", default: "Mod+S", label: "X" }] }]);
		// biome-ignore lint/suspicious/noExplicitAny: forcing an empty appId for the test
		(env as any).app = "";
		await expect(handle(env)).rejects.toMatchObject({ name: "Invalid" });
	});
});
