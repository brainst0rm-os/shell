import { describe, expect, it } from "vitest";
import { LogLevel } from "../diagnostics/error-log";
import { RECENT_LOG_BUFFER_BYTES, RecentLogBuffer } from "./recent-log-buffer";

describe("RecentLogBuffer", () => {
	it("starts empty", () => {
		const buf = new RecentLogBuffer();
		expect(buf.read()).toBe("");
		expect(buf.lineCount).toBe(0);
		expect(buf.sizeBytes).toBe(0);
	});

	it("appends a line", () => {
		const buf = new RecentLogBuffer({ now: () => 1_700_000_000_000 });
		buf.append({ level: LogLevel.Error, scope: "shell-renderer", message: "boom" });
		expect(buf.lineCount).toBe(1);
		expect(buf.read()).toContain("[error]");
		expect(buf.read()).toContain("(shell-renderer)");
		expect(buf.read()).toContain("boom");
	});

	it("preserves insertion order in read()", () => {
		const buf = new RecentLogBuffer({ now: () => 1_700_000_000_000 });
		buf.append({ level: LogLevel.Warn, scope: "main", message: "first" });
		buf.append({ level: LogLevel.Error, scope: "app:notes", message: "second" });
		const out = buf.read();
		expect(out.indexOf("first")).toBeLessThan(out.indexOf("second"));
	});

	it("evicts oldest line when capacity is exceeded", () => {
		const buf = new RecentLogBuffer({ maxBytes: 200, now: () => 1_700_000_000_000 });
		buf.append({ level: LogLevel.Error, scope: "main", message: "a".repeat(150) });
		buf.append({ level: LogLevel.Error, scope: "main", message: "b".repeat(150) });
		expect(buf.lineCount).toBe(1);
		expect(buf.read()).toContain("b");
		expect(buf.read()).not.toContain("aaa");
	});

	it("default cap matches the payload cap", () => {
		expect(RECENT_LOG_BUFFER_BYTES).toBe(64 * 1024);
	});

	it("clear empties the buffer", () => {
		const buf = new RecentLogBuffer({ now: () => 1_700_000_000_000 });
		buf.append({ level: LogLevel.Warn, scope: "main", message: "hello" });
		buf.clear();
		expect(buf.lineCount).toBe(0);
		expect(buf.read()).toBe("");
	});

	it("attach() wires a webContents-shaped listener that filters info/log/debug", () => {
		const buf = new RecentLogBuffer({ now: () => 1_700_000_000_000 });
		const handlers: Record<string, (...args: unknown[]) => void> = {};
		const wc = {
			on: (event: string, listener: (...args: unknown[]) => void) => {
				handlers[event] = listener;
				return wc;
			},
		};
		buf.attach(wc, "app:test");
		expect(handlers["console-message"]).toBeDefined();
		const fire = handlers["console-message"];
		if (!fire) throw new Error("listener not attached");
		fire({ level: "error", message: "real error" });
		fire({ level: "info", message: "noisy info" });
		fire({ level: "warning", message: "real warn" });
		fire({ level: "log", message: "even quieter" });
		const out = buf.read();
		expect(out).toContain("real error");
		expect(out).toContain("real warn");
		expect(out).not.toContain("noisy info");
		expect(out).not.toContain("even quieter");
	});

	it("attach() records the scope per line", () => {
		const buf = new RecentLogBuffer({ now: () => 1_700_000_000_000 });
		const handlers: Record<string, (...args: unknown[]) => void> = {};
		const wc = {
			on: (event: string, listener: (...args: unknown[]) => void) => {
				handlers[event] = listener;
				return wc;
			},
		};
		buf.attach(wc, "app:notes");
		const fire = handlers["console-message"];
		if (!fire) throw new Error("listener not attached");
		fire({ level: "error", message: "boom" });
		expect(buf.read()).toContain("(app:notes)");
	});
});
