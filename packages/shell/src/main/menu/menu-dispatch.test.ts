import { describe, expect, it, vi } from "vitest";
import { MenuRouter } from "./menu-dispatch";

describe("MenuRouter", () => {
	it("runs the registered shell handler for shell/<action>", async () => {
		const calls: string[] = [];
		const router = new MenuRouter(() => {
			throw new Error("should not be called for shell ids");
		});
		router.registerShellHandler("new-vault", (a) => {
			calls.push(a);
		});
		const result = await router.dispatch("shell/new-vault");
		expect(result).toEqual({ kind: "shell", action: "new-vault" });
		expect(calls).toEqual(["new-vault"]);
	});

	it("reports unknown shell actions without throwing", async () => {
		const router = new MenuRouter(() => undefined);
		const result = await router.dispatch("shell/never-registered");
		expect(result).toEqual({ kind: "shell-unknown", action: "never-registered" });
	});

	it("routes app/<action> via sendToFocusedApp", async () => {
		const sender = vi.fn();
		const router = new MenuRouter(sender);
		const result = await router.dispatch("io.example.editor/save");
		expect(result).toEqual({ kind: "app", appId: "io.example.editor", action: "save" });
		expect(sender).toHaveBeenCalledWith("io.example.editor", { action: "save" });
	});

	it("returns malformed for ids without a slash", async () => {
		const router = new MenuRouter(() => undefined);
		expect(await router.dispatch("just-an-action")).toEqual({ kind: "malformed" });
		expect(await router.dispatch("")).toEqual({ kind: "malformed" });
	});

	it("unregisterShellHandler removes the handler", async () => {
		const router = new MenuRouter(() => undefined);
		router.registerShellHandler("settings", () => undefined);
		router.unregisterShellHandler("settings");
		const result = await router.dispatch("shell/settings");
		expect(result.kind).toBe("shell-unknown");
	});

	it("listShellActions returns sorted registered action ids", () => {
		const router = new MenuRouter(() => undefined);
		router.registerShellHandler("b", () => undefined);
		router.registerShellHandler("a", () => undefined);
		expect(router.listShellActions()).toEqual(["a", "b"]);
	});

	it("propagates an async handler's throw", async () => {
		const router = new MenuRouter(() => undefined);
		router.registerShellHandler("crash", () => {
			throw new Error("boom");
		});
		await expect(router.dispatch("shell/crash")).rejects.toThrow("boom");
	});

	it("forwards the click payload to the handler", async () => {
		const calls: { action: string; topicId?: string }[] = [];
		const router = new MenuRouter(() => undefined);
		router.registerShellHandler("help", (action, payload) => {
			calls.push({ action, ...(payload?.topicId ? { topicId: payload.topicId } : {}) });
		});
		await router.dispatch("shell/help", { topicId: "guide/x" });
		expect(calls).toEqual([{ action: "help", topicId: "guide/x" }]);
	});

	it("matches a parent-prefix shell action (help.section.* → help handler)", async () => {
		const calls: { action: string; topicId?: string }[] = [];
		const router = new MenuRouter(() => undefined);
		router.registerShellHandler("help", (action, payload) => {
			calls.push({ action, ...(payload?.topicId ? { topicId: payload.topicId } : {}) });
		});
		const result = await router.dispatch("shell/help.section.guides", { topicId: "guide/x" });
		expect(result).toEqual({ kind: "shell", action: "help.section.guides" });
		expect(calls).toEqual([{ action: "help.section.guides", topicId: "guide/x" }]);
	});
});
