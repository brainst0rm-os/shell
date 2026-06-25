// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OffscreenGate, OffscreenGateProvider, createOffscreenObserver } from "./decorator-unmount";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function must<T>(v: T | null | undefined, m: string): T {
	if (v == null) throw new Error(m);
	return v;
}

type FakeObserverHandle = {
	callback: IntersectionObserverCallback;
	observed: Element[];
	unobserved: Element[];
	disconnected: boolean;
	options: IntersectionObserverInit | undefined;
};

let lastObserver: FakeObserverHandle | null = null;
const originalIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
	.IntersectionObserver;

function installFakeIO(): void {
	class FakeIntersectionObserver {
		readonly callback: IntersectionObserverCallback;
		readonly observed: Element[] = [];
		readonly unobserved: Element[] = [];
		readonly options: IntersectionObserverInit | undefined;
		disconnected = false;

		constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
			this.callback = callback;
			this.options = options;
			lastObserver = {
				callback,
				observed: this.observed,
				unobserved: this.unobserved,
				disconnected: false,
				options,
			};
		}
		observe(el: Element): void {
			this.observed.push(el);
		}
		unobserve(el: Element): void {
			this.unobserved.push(el);
			if (lastObserver) lastObserver.unobserved = this.unobserved;
		}
		disconnect(): void {
			this.disconnected = true;
			if (lastObserver) lastObserver.disconnected = true;
		}
		takeRecords(): IntersectionObserverEntry[] {
			return [];
		}
		root: Element | Document | null = null;
		rootMargin = "";
		thresholds: ReadonlyArray<number> = [];
	}
	(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
		FakeIntersectionObserver as unknown as typeof IntersectionObserver;
}

function uninstallFakeIO(): void {
	if (originalIO) {
		(globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
			originalIO;
	} else {
		// biome-ignore lint/performance/noDelete: test must remove the global (exactOptionalPropertyTypes rejects = undefined)
		delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
			.IntersectionObserver;
	}
	lastObserver = null;
}

function makeEntry(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
	return {
		target,
		isIntersecting,
		intersectionRatio: isIntersecting ? 1 : 0,
		boundingClientRect: {} as DOMRectReadOnly,
		intersectionRect: {} as DOMRectReadOnly,
		rootBounds: {} as DOMRectReadOnly,
		time: 0,
	} as IntersectionObserverEntry;
}

describe("<OffscreenGate>", () => {
	let container: HTMLDivElement;
	let root: ReturnType<typeof createRoot>;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		uninstallFakeIO();
	});

	it("without a provider, renders children immediately (fail-open path)", async () => {
		installFakeIO();
		await act(async () => {
			root.render(
				<OffscreenGate height={100}>
					<span data-testid="child">visible</span>
				</OffscreenGate>,
			);
		});
		expect(container.querySelector("[data-testid='child']")).not.toBeNull();
	});

	it("inside a provider, initial render shows the placeholder div (aria-hidden + reserved height)", async () => {
		installFakeIO();
		await act(async () => {
			root.render(
				<OffscreenGateProvider>
					<OffscreenGate height={100}>
						<span data-testid="child">visible</span>
					</OffscreenGate>
				</OffscreenGateProvider>,
			);
		});
		expect(container.querySelector("[data-testid='child']")).toBeNull();
		const placeholder = container.querySelector("div[aria-hidden]") as HTMLDivElement | null;
		expect(placeholder).not.toBeNull();
		expect(must(placeholder, "placeholder").style.height).toBe("100px");
	});

	it("an isIntersecting=true callback re-renders the children", async () => {
		installFakeIO();
		await act(async () => {
			root.render(
				<OffscreenGateProvider>
					<OffscreenGate height={100}>
						<span data-testid="child">visible</span>
					</OffscreenGate>
				</OffscreenGateProvider>,
			);
		});
		expect(container.querySelector("[data-testid='child']")).toBeNull();

		const observedEl = lastObserver?.observed[0];
		expect(observedEl).toBeDefined();
		await act(async () => {
			must(lastObserver, "lastObserver").callback(
				[makeEntry(must(observedEl, "observedEl"), true)],
				lastObserver as unknown as IntersectionObserver,
			);
		});

		expect(container.querySelector("[data-testid='child']")).not.toBeNull();
	});

	it("flipping back to isIntersecting=false collapses to the placeholder again", async () => {
		installFakeIO();
		await act(async () => {
			root.render(
				<OffscreenGateProvider>
					<OffscreenGate height={50}>
						<span data-testid="child">visible</span>
					</OffscreenGate>
				</OffscreenGateProvider>,
			);
		});
		const observedEl = lastObserver?.observed[0];
		expect(observedEl).toBeDefined();
		await act(async () => {
			must(lastObserver, "lastObserver").callback(
				[makeEntry(must(observedEl, "observedEl"), true)],
				lastObserver as unknown as IntersectionObserver,
			);
		});
		expect(container.querySelector("[data-testid='child']")).not.toBeNull();
		await act(async () => {
			// the host element changes when the gate flips to visible — re-observe
			// the *new* host that the gate is now using.
			const newHost =
				must(container.querySelector("[data-testid='child']"), "child").parentElement ?? observedEl;
			must(lastObserver, "lastObserver").callback(
				[makeEntry(newHost as Element, false)],
				lastObserver as unknown as IntersectionObserver,
			);
		});
		expect(container.querySelector("[data-testid='child']")).toBeNull();
		const placeholder = container.querySelector("div[aria-hidden]") as HTMLDivElement | null;
		expect(placeholder).not.toBeNull();
		expect(must(placeholder, "placeholder").style.height).toBe("50px");
	});

	it("placeholder height reflects the `height` prop verbatim", async () => {
		installFakeIO();
		await act(async () => {
			root.render(
				<OffscreenGateProvider>
					<OffscreenGate height={777}>
						<span>x</span>
					</OffscreenGate>
				</OffscreenGateProvider>,
			);
		});
		const placeholder = container.querySelector("div[aria-hidden]") as HTMLDivElement | null;
		expect(placeholder).not.toBeNull();
		expect(must(placeholder, "placeholder").style.height).toBe("777px");
	});

	it("unmount disposes the shared observer (provider lifecycle calls observer.dispose())", async () => {
		installFakeIO();
		await act(async () => {
			root.render(
				<OffscreenGateProvider>
					<OffscreenGate height={10}>
						<span>x</span>
					</OffscreenGate>
				</OffscreenGateProvider>,
			);
		});
		expect(lastObserver?.disconnected).toBe(false);
		await act(async () => root.unmount());
		expect(lastObserver?.disconnected).toBe(true);
		// re-create the unmount the afterEach will run.
		root = createRoot(container);
	});
});

describe("createOffscreenObserver", () => {
	afterEach(() => {
		uninstallFakeIO();
	});

	it("when IntersectionObserver is undefined, register() fires its callback with true synchronously (fail-open)", () => {
		// biome-ignore lint/performance/noDelete: test must remove the global (exactOptionalPropertyTypes rejects = undefined)
		delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
			.IntersectionObserver;
		const observer = createOffscreenObserver();
		const calls: boolean[] = [];
		const el = { nodeType: 1 } as unknown as Element;
		const dispose = observer.register(el, (visible) => {
			calls.push(visible);
		});
		expect(calls).toEqual([true]);
		expect(() => dispose()).not.toThrow();
		expect(() => observer.dispose()).not.toThrow();
	});

	it("`dispose()` calls disconnect() on the underlying IntersectionObserver", () => {
		installFakeIO();
		const observer = createOffscreenObserver();
		expect(lastObserver?.disconnected).toBe(false);
		observer.dispose();
		expect(lastObserver?.disconnected).toBe(true);
	});

	it("forwards the `rootMargin` option (default `200px`)", () => {
		installFakeIO();
		createOffscreenObserver();
		expect(lastObserver?.options?.rootMargin).toBe("200px");
		uninstallFakeIO();
		installFakeIO();
		createOffscreenObserver("400px");
		expect(lastObserver?.options?.rootMargin).toBe("400px");
	});
});
