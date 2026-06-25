/**
 * Feedback-2 — Electron hook wiring tests.
 *
 * Drives `installCrashHooks` with a fake `app` + `webContents` so we
 * can assert that `render-process-gone` flows into the service with
 * the right `CrashKind`, that uncaught/unhandled listeners are
 * installed + removed, and that the surface resolver picks up
 * `appId` + `routePath` from the URL.
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrashKind, RendererReason } from "./crash-payload";
import { installCrashHooks } from "./crash-reporter-hooks";

type Capture = Parameters<
	typeof import("./crash-reporter-service").CrashReporterService.prototype["capture"]
>[0];

class FakeWebContents extends EventEmitter {
	private url: string;
	constructor(url: string) {
		super();
		this.url = url;
	}
	getURL(): string {
		return this.url;
	}
}

class FakeApp extends EventEmitter {}

function makeServiceStub() {
	const captures: Capture[] = [];
	return {
		capture: vi.fn(async (input: Capture) => {
			captures.push(input);
		}),
		submitPending: vi.fn(),
		getLocalCounter: vi.fn(),
		resetLocalCounter: vi.fn(),
		captures,
	};
}

let uninstall: (() => void) | null = null;

afterEach(() => {
	uninstall?.();
	uninstall = null;
});

beforeEach(() => {
	// vitest doesn't reset process listeners between cases; the hook
	// uninstaller covers that, but if we ever forget to call it the
	// assertion of "1 new listener" guards against silent accumulation.
});

describe("installCrashHooks — Electron wiring", () => {
	it("captures an uncaughtException through the service", async () => {
		const service = makeServiceStub();
		const app = new FakeApp();
		uninstall = installCrashHooks({
			service: service as unknown as Parameters<typeof installCrashHooks>[0]["service"],
			app: app as unknown as Parameters<typeof installCrashHooks>[0]["app"],
		});
		const error = new Error("synthetic-uncaught");
		process.emit("uncaughtException", error);
		await Promise.resolve();
		expect(service.capture).toHaveBeenCalledTimes(1);
		const call = service.captures[0];
		expect(call?.kind).toBe(CrashKind.UncaughtException);
		expect(call?.message).toBe("synthetic-uncaught");
		expect(call?.stack).toContain("Error: synthetic-uncaught");
	});

	it("captures an unhandledRejection through the service", async () => {
		const service = makeServiceStub();
		const app = new FakeApp();
		uninstall = installCrashHooks({
			service: service as unknown as Parameters<typeof installCrashHooks>[0]["service"],
			app: app as unknown as Parameters<typeof installCrashHooks>[0]["app"],
		});
		process.emit("unhandledRejection", new Error("synthetic-rejection"), Promise.resolve());
		await Promise.resolve();
		expect(service.capture).toHaveBeenCalledTimes(1);
		const call = service.captures[0];
		expect(call?.kind).toBe(CrashKind.UnhandledRejection);
		expect(call?.message).toBe("synthetic-rejection");
	});

	it("captures render-process-gone with the right CrashKind + reason + exitCode", async () => {
		const service = makeServiceStub();
		const app = new FakeApp();
		uninstall = installCrashHooks({
			service: service as unknown as Parameters<typeof installCrashHooks>[0]["service"],
			app: app as unknown as Parameters<typeof installCrashHooks>[0]["app"],
		});
		const wc = new FakeWebContents("file:///some/apps/notes/dist/index.html");
		app.emit("web-contents-created", {}, wc);
		wc.emit("render-process-gone", {}, { reason: "oom", exitCode: 9 });
		await Promise.resolve();
		expect(service.capture).toHaveBeenCalledTimes(1);
		const call = service.captures[0];
		expect(call?.kind).toBe(CrashKind.RendererProcessGone);
		expect(call?.rendererReason).toBe(RendererReason.OutOfMemory);
		expect(call?.exitCode).toBe(9);
		expect(call?.appId).toBe("notes");
	});

	it("captures unresponsive renderers", async () => {
		const service = makeServiceStub();
		const app = new FakeApp();
		uninstall = installCrashHooks({
			service: service as unknown as Parameters<typeof installCrashHooks>[0]["service"],
			app: app as unknown as Parameters<typeof installCrashHooks>[0]["app"],
		});
		const wc = new FakeWebContents("file:///x/apps/graph/dist/index.html");
		app.emit("web-contents-created", {}, wc);
		wc.emit("unresponsive");
		await Promise.resolve();
		expect(service.capture).toHaveBeenCalledTimes(1);
		expect(service.captures[0]?.kind).toBe(CrashKind.UnresponsiveRenderer);
		expect(service.captures[0]?.appId).toBe("graph");
	});

	it("falls back to no appId when URL lacks an apps/ segment", async () => {
		const service = makeServiceStub();
		const app = new FakeApp();
		uninstall = installCrashHooks({
			service: service as unknown as Parameters<typeof installCrashHooks>[0]["service"],
			app: app as unknown as Parameters<typeof installCrashHooks>[0]["app"],
		});
		const wc = new FakeWebContents("file:///x/renderer/dashboard.html");
		app.emit("web-contents-created", {}, wc);
		wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 0 });
		await Promise.resolve();
		expect(service.captures[0]?.appId).toBeUndefined();
	});

	it("crashReporter.start is invoked with uploadToServer=false", () => {
		const service = makeServiceStub();
		const app = new FakeApp();
		const start = vi.fn();
		uninstall = installCrashHooks({
			service: service as unknown as Parameters<typeof installCrashHooks>[0]["service"],
			app: app as unknown as Parameters<typeof installCrashHooks>[0]["app"],
			crashReporter: { start },
		});
		expect(start).toHaveBeenCalledTimes(1);
		const args = start.mock.calls[0]?.[0] as { uploadToServer: boolean };
		expect(args?.uploadToServer).toBe(false);
	});

	it("uninstall removes the process listeners", () => {
		const service = makeServiceStub();
		const app = new FakeApp();
		const beforeUncaught = process.listenerCount("uncaughtException");
		const beforeUnhandled = process.listenerCount("unhandledRejection");
		uninstall = installCrashHooks({
			service: service as unknown as Parameters<typeof installCrashHooks>[0]["service"],
			app: app as unknown as Parameters<typeof installCrashHooks>[0]["app"],
		});
		expect(process.listenerCount("uncaughtException")).toBe(beforeUncaught + 1);
		uninstall?.();
		uninstall = null;
		expect(process.listenerCount("uncaughtException")).toBe(beforeUncaught);
		expect(process.listenerCount("unhandledRejection")).toBe(beforeUnhandled);
	});
});
