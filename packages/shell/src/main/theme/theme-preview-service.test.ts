import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "../../ipc/envelope";
import {
	ThemePreviewService,
	type ThemePreviewTimers,
	makeThemeServiceHandler,
} from "./theme-preview-service";

/** A fake timer registry so the preview→revert lifecycle is deterministic. */
function fakeTimers() {
	let next = 1;
	const pending = new Map<number, { cb: () => void; ms: number }>();
	const timers: ThemePreviewTimers = {
		set(cb, ms) {
			const id = next++;
			pending.set(id, { cb, ms });
			return id;
		},
		clear(handle) {
			pending.delete(handle as number);
		},
	};
	return {
		timers,
		fire(id: number) {
			const t = pending.get(id);
			if (t) {
				pending.delete(id);
				t.cb();
			}
		},
		size: () => pending.size,
	};
}

function envelope(method: string, args: unknown[] = []): Envelope {
	return { app: "io.brainstorm.theme-editor", service: "theme", method, args } as Envelope;
}

describe("ThemePreviewService", () => {
	it("broadcasts a sanitized payload then auto-reverts after the duration", () => {
		const broadcast = vi.fn();
		const ft = fakeTimers();
		const svc = new ThemePreviewService(broadcast, ft.timers);
		svc.preview({ vars: { "--color-accent-default": "#268bd2", "--bogus": "x" }, durationMs: 3000 });
		expect(broadcast).toHaveBeenCalledTimes(1);
		expect(broadcast.mock.calls[0]?.[0]).toEqual({
			vars: { "--color-accent-default": "#268bd2" },
			appearance: null,
			durationMs: 3000,
		});
		expect(ft.size()).toBe(1);
		ft.fire(1);
		expect(broadcast).toHaveBeenCalledTimes(2);
		expect(broadcast.mock.calls[1]?.[0]).toBeNull();
	});

	it("a new preview replaces the in-flight one (cancels its timer)", () => {
		const broadcast = vi.fn();
		const ft = fakeTimers();
		const svc = new ThemePreviewService(broadcast, ft.timers);
		svc.preview({ vars: {}, durationMs: 5000 });
		svc.preview({ vars: {}, durationMs: 5000 });
		// First timer cancelled; only the second is pending.
		expect(ft.size()).toBe(1);
		ft.fire(2);
		expect(broadcast.mock.calls.filter((c) => c[0] === null)).toHaveLength(1);
	});

	it("clearPreview reverts immediately + cancels the timer", () => {
		const broadcast = vi.fn();
		const ft = fakeTimers();
		const svc = new ThemePreviewService(broadcast, ft.timers);
		svc.preview({ vars: {}, durationMs: 5000 });
		svc.clearPreview();
		expect(broadcast).toHaveBeenLastCalledWith(null);
		expect(ft.size()).toBe(0);
	});

	it("dispose drops a pending revert without broadcasting", () => {
		const broadcast = vi.fn();
		const ft = fakeTimers();
		const svc = new ThemePreviewService(broadcast, ft.timers);
		svc.preview({ vars: {}, durationMs: 5000 });
		const before = broadcast.mock.calls.length;
		svc.dispose();
		expect(ft.size()).toBe(0);
		expect(broadcast.mock.calls.length).toBe(before);
	});
});

describe("makeThemeServiceHandler", () => {
	it("routes preview / clearPreview", () => {
		const broadcast = vi.fn();
		const svc = new ThemePreviewService(broadcast, fakeTimers().timers);
		const handler = makeThemeServiceHandler(svc);
		handler(envelope("preview", [{ vars: {} }]));
		handler(envelope("clearPreview"));
		expect(broadcast).toHaveBeenCalled();
	});

	it("throws Invalid on an unknown method", () => {
		const svc = new ThemePreviewService(vi.fn(), fakeTimers().timers);
		const handler = makeThemeServiceHandler(svc);
		expect(() => handler(envelope("nope"))).toThrow(/unknown theme method/);
	});
});
