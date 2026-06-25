/**
 * Widget host (Stage 7.3, OQ-6 → (a)). Owns the lifecycle of the dashboard's
 * widget surfaces: each placed widget is its own broker-scoped `WebContentsView`
 * overlaid on the dashboard window, running the parent app's bundle in
 * widget-mode (launch reason `widget`).
 *
 * This module is the pure lifecycle/reconcile/layout core — surface creation
 * (resolving the app record, building the view, attaching it to the dashboard
 * window, registering renderer identity) is injected as a `WidgetSurfaceFactory`
 * so the host is unit-testable without Electron. The production factory lives in
 * `widget-surface-factory.ts` and is wired in `index.ts`.
 *
 * Geometry + visibility are driven from the dashboard RENDERER (grid→pixel
 * depends on the live viewport + scroll, which only the renderer knows): the
 * renderer reports `[{id, rect, visible}]` via the `dashboard:layout-widgets`
 * IPC and the host applies it. A widget that scrolls off-screen is hidden
 * (`setVisible(false)`) AND told to pause via `sendVisibility(false)` so it
 * stops its render loop / timers — native views can't be DOM-observed, so this
 * host-driven signal is the pause mechanism (per OQ-6's resolution).
 */

export type WidgetPlacement = {
	/** The dashboard widget record id — the stable placement identity. */
	id: string;
	appId: string;
	/** Which registered widget of the app to render (manifest widget id). */
	widgetId: string;
	/** Optional entity / saved-view id for a parameterised widget. */
	bind?: string;
};

export type WidgetRect = { x: number; y: number; width: number; height: number };

export type WidgetLayout = {
	id: string;
	rect: WidgetRect;
	/** True when the slot is within the scrolled dashboard viewport. */
	visible: boolean;
};

/** A live widget surface — the thin handle the host drives. */
export interface WidgetSurface {
	readonly webContentsId: number;
	setBounds(rect: WidgetRect): void;
	setVisible(visible: boolean): void;
	/** Tell the widget renderer to pause (false) / resume (true) its work. */
	sendVisibility(visible: boolean): void;
	destroy(): void;
}

/** Builds the surface for a placement, or null when it can't be created (app
 *  uninstalled, manifest missing the widget, etc.). */
export type WidgetSurfaceFactory = (placement: WidgetPlacement) => WidgetSurface | null;

type LiveWidget = {
	placement: WidgetPlacement;
	surface: WidgetSurface;
	visible: boolean;
};

/** Two placements address the same surface only when app + widget + bind all
 *  match; any change recreates the surface (it's a different render). */
function sameTarget(a: WidgetPlacement, b: WidgetPlacement): boolean {
	return a.appId === b.appId && a.widgetId === b.widgetId && a.bind === b.bind;
}

export class WidgetHost {
	private readonly surfaces = new Map<string, LiveWidget>();

	constructor(private readonly factory: WidgetSurfaceFactory) {}

	/** Reconcile live surfaces against the placed-widget set: create surfaces for
	 *  new placements, destroy those that were removed or re-targeted. */
	reconcile(placements: readonly WidgetPlacement[]): void {
		const wanted = new Map(placements.map((p) => [p.id, p] as const));
		for (const [id, live] of [...this.surfaces]) {
			const next = wanted.get(id);
			if (!next || !sameTarget(next, live.placement)) {
				live.surface.destroy();
				this.surfaces.delete(id);
			}
		}
		for (const placement of placements) {
			if (this.surfaces.has(placement.id)) continue;
			const surface = this.factory(placement);
			if (!surface) continue;
			// New surfaces start hidden; the next layout tick reveals the on-screen
			// ones (and pauses the rest) once the renderer reports geometry.
			surface.setVisible(false);
			this.surfaces.set(placement.id, { placement, surface, visible: false });
		}
	}

	/** Apply renderer-reported geometry + visibility. A live surface with no
	 *  layout this tick is treated as off-screen and hidden + paused. */
	layout(layouts: readonly WidgetLayout[]): void {
		const seen = new Set<string>();
		for (const entry of layouts) {
			const live = this.surfaces.get(entry.id);
			if (!live) continue;
			seen.add(entry.id);
			live.surface.setBounds(entry.rect);
			this.applyVisibility(live, entry.visible);
		}
		for (const [id, live] of this.surfaces) {
			if (seen.has(id)) continue;
			this.applyVisibility(live, false);
		}
	}

	private applyVisibility(live: LiveWidget, visible: boolean): void {
		live.surface.setVisible(visible);
		if (live.visible === visible) return;
		live.visible = visible;
		// Only signal the renderer on an actual transition — the pause/resume
		// edge, not every layout tick (scroll fires these continuously).
		live.surface.sendVisibility(visible);
	}

	/** Drop every surface (vault switch / shutdown). */
	destroyAll(): void {
		for (const live of this.surfaces.values()) live.surface.destroy();
		this.surfaces.clear();
	}

	/** Destroy any surfaces owned by `appId` (uninstall / app update). The next
	 *  reconcile recreates still-placed widgets against the new bundle. */
	destroyForApp(appId: string): void {
		for (const [id, live] of [...this.surfaces]) {
			if (live.placement.appId !== appId) continue;
			live.surface.destroy();
			this.surfaces.delete(id);
		}
	}

	has(id: string): boolean {
		return this.surfaces.has(id);
	}

	get size(): number {
		return this.surfaces.size;
	}
}
