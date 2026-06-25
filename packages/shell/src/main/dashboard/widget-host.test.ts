import { describe, expect, it, vi } from "vitest";
import { WidgetHost, type WidgetPlacement, type WidgetSurface } from "./widget-host";

let nextId = 1;

function fakeSurface() {
	const calls = {
		setBounds: vi.fn<(r: unknown) => void>(),
		setVisible: vi.fn<(v: boolean) => void>(),
		sendVisibility: vi.fn<(v: boolean) => void>(),
		destroy: vi.fn<() => void>(),
	};
	const surface: WidgetSurface = {
		webContentsId: nextId++,
		setBounds: calls.setBounds,
		setVisible: calls.setVisible,
		sendVisibility: calls.sendVisibility,
		destroy: calls.destroy,
	};
	return { surface, calls };
}

function placement(over: Partial<WidgetPlacement> & { id: string }): WidgetPlacement {
	return { appId: "io.app", widgetId: "w", ...over };
}

describe("WidgetHost.reconcile", () => {
	it("creates a surface per placement and starts it hidden", () => {
		const made = new Map<string, ReturnType<typeof fakeSurface>>();
		const host = new WidgetHost((p) => {
			const f = fakeSurface();
			made.set(p.id, f);
			return f.surface;
		});

		host.reconcile([placement({ id: "a" }), placement({ id: "b" })]);

		expect(host.size).toBe(2);
		expect(made.get("a")?.calls.setVisible).toHaveBeenCalledWith(false);
	});

	it("destroys surfaces removed from the placement set", () => {
		const made = new Map<string, ReturnType<typeof fakeSurface>>();
		const host = new WidgetHost((p) => {
			const f = fakeSurface();
			made.set(p.id, f);
			return f.surface;
		});

		host.reconcile([placement({ id: "a" }), placement({ id: "b" })]);
		host.reconcile([placement({ id: "a" })]);

		expect(host.size).toBe(1);
		expect(made.get("b")?.calls.destroy).toHaveBeenCalledTimes(1);
		expect(made.get("a")?.calls.destroy).not.toHaveBeenCalled();
	});

	it("recreates a surface when its widget target changes", () => {
		const made: ReturnType<typeof fakeSurface>[] = [];
		const host = new WidgetHost(() => {
			const f = fakeSurface();
			made.push(f);
			return f.surface;
		});

		host.reconcile([placement({ id: "a", widgetId: "recent" })]);
		host.reconcile([placement({ id: "a", widgetId: "agenda" })]);

		expect(made).toHaveLength(2);
		expect(made[0]?.calls.destroy).toHaveBeenCalledTimes(1);
	});

	it("skips placements the factory cannot build (returns null)", () => {
		const host = new WidgetHost(() => null);
		host.reconcile([placement({ id: "a" })]);
		expect(host.size).toBe(0);
	});
});

describe("WidgetHost.layout", () => {
	it("positions and reveals on-screen widgets, signalling the visibility edge once", () => {
		const f = fakeSurface();
		const host = new WidgetHost(() => f.surface);
		host.reconcile([placement({ id: "a" })]);

		const rect = { x: 10, y: 20, width: 200, height: 120 };
		host.layout([{ id: "a", rect, visible: true }]);

		expect(f.calls.setBounds).toHaveBeenCalledWith(rect);
		expect(f.calls.setVisible).toHaveBeenLastCalledWith(true);
		// One resume edge (false→true); the initial hidden state was the create.
		expect(f.calls.sendVisibility).toHaveBeenCalledTimes(1);
		expect(f.calls.sendVisibility).toHaveBeenCalledWith(true);
	});

	it("pauses a widget that scrolls off-screen and resumes it when back", () => {
		const f = fakeSurface();
		const host = new WidgetHost(() => f.surface);
		host.reconcile([placement({ id: "a" })]);
		const rect = { x: 0, y: 0, width: 100, height: 100 };

		host.layout([{ id: "a", rect, visible: true }]); // resume
		host.layout([{ id: "a", rect, visible: false }]); // pause
		host.layout([{ id: "a", rect, visible: true }]); // resume

		expect(f.calls.sendVisibility.mock.calls.map((c) => c[0])).toEqual([true, false, true]);
	});

	it("hides + pauses a live surface that has no layout entry this tick", () => {
		const f = fakeSurface();
		const host = new WidgetHost(() => f.surface);
		host.reconcile([placement({ id: "a" })]);
		host.layout([{ id: "a", rect: { x: 0, y: 0, width: 1, height: 1 }, visible: true }]);

		host.layout([]); // 'a' dropped from the report → off-screen

		expect(f.calls.setVisible).toHaveBeenLastCalledWith(false);
		expect(f.calls.sendVisibility).toHaveBeenLastCalledWith(false);
	});

	it("does not re-signal visibility on an unchanged tick (scroll churn)", () => {
		const f = fakeSurface();
		const host = new WidgetHost(() => f.surface);
		host.reconcile([placement({ id: "a" })]);
		const l = { id: "a", rect: { x: 0, y: 0, width: 1, height: 1 }, visible: true };

		host.layout([l]);
		host.layout([l]);
		host.layout([l]);

		expect(f.calls.sendVisibility).toHaveBeenCalledTimes(1); // single resume edge
		expect(f.calls.setBounds).toHaveBeenCalledTimes(3); // bounds still re-applied
	});
});

describe("WidgetHost teardown", () => {
	it("destroyForApp drops only that app's surfaces", () => {
		const made = new Map<string, ReturnType<typeof fakeSurface>>();
		const host = new WidgetHost((p) => {
			const f = fakeSurface();
			made.set(p.id, f);
			return f.surface;
		});
		host.reconcile([
			placement({ id: "a", appId: "io.notes" }),
			placement({ id: "b", appId: "io.tasks" }),
		]);

		host.destroyForApp("io.notes");

		expect(host.size).toBe(1);
		expect(made.get("a")?.calls.destroy).toHaveBeenCalledTimes(1);
		expect(made.get("b")?.calls.destroy).not.toHaveBeenCalled();
	});

	it("destroyAll destroys every surface", () => {
		const made: ReturnType<typeof fakeSurface>[] = [];
		const host = new WidgetHost(() => {
			const f = fakeSurface();
			made.push(f);
			return f.surface;
		});
		host.reconcile([placement({ id: "a" }), placement({ id: "b" })]);

		host.destroyAll();

		expect(host.size).toBe(0);
		expect(made.every((m) => m.calls.destroy.mock.calls.length === 1)).toBe(true);
	});
});
