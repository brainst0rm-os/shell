// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BLOCK_FRAME_ALLOW,
	BLOCK_FRAME_CSP,
	BLOCK_FRAME_CSP_DIRECTIVES,
	BLOCK_FRAME_DEFAULT_CLASS,
	BLOCK_FRAME_LOADING,
	BLOCK_FRAME_REFERRER_POLICY,
	BLOCK_FRAME_SANDBOX,
	BLOCK_FRAME_SANDBOX_TOKENS,
	BLOCK_FRAME_SRCDOC,
	type BlockFrameHandle,
	BlockFramePhase,
	createBlockFrame,
} from "./index";

interface FakeIntersectionObserverInstance {
	observed: Element[];
	disconnected: boolean;
	fire(entries: Array<Partial<IntersectionObserverEntry>>): void;
}

let lastIntersection: FakeIntersectionObserverInstance | null = null;

class FakeIntersectionObserver implements FakeIntersectionObserverInstance {
	observed: Element[] = [];
	disconnected = false;
	private cb: IntersectionObserverCallback;

	constructor(cb: IntersectionObserverCallback) {
		this.cb = cb;
		lastIntersection = this;
	}

	observe(el: Element): void {
		this.observed.push(el);
	}
	unobserve(_el: Element): void {
		/* noop */
	}
	disconnect(): void {
		this.disconnected = true;
	}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
	root: Element | null = null;
	rootMargin = "";
	thresholds: readonly number[] = [];

	fire(entries: Array<Partial<IntersectionObserverEntry>>): void {
		this.cb(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
	}
}

interface FakeResizeObserverInstance {
	observed: Element[];
	disconnected: boolean;
	fire(entries: Array<{ contentRect: { width: number; height: number } }>): void;
}

let lastResize: FakeResizeObserverInstance | null = null;

class FakeResizeObserver implements FakeResizeObserverInstance {
	observed: Element[] = [];
	disconnected = false;
	private cb: ResizeObserverCallback;

	constructor(cb: ResizeObserverCallback) {
		this.cb = cb;
		lastResize = this;
	}

	observe(el: Element): void {
		this.observed.push(el);
	}
	unobserve(_el: Element): void {
		/* noop */
	}
	disconnect(): void {
		this.disconnected = true;
	}

	fire(entries: Array<{ contentRect: { width: number; height: number } }>): void {
		this.cb(entries as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
	}
}

function makeContainer(): HTMLElement {
	const el = document.createElement("div");
	document.body.appendChild(el);
	return el;
}

describe("block-frame constants", () => {
	it("sandbox tokens are exactly [allow-scripts]", () => {
		expect([...BLOCK_FRAME_SANDBOX_TOKENS]).toEqual(["allow-scripts"]);
		expect(BLOCK_FRAME_SANDBOX).toBe("allow-scripts");
	});

	it("sandbox does NOT include any escape-hatch tokens", () => {
		const escapes = [
			"allow-same-origin",
			"allow-forms",
			"allow-popups",
			"allow-popups-to-escape-sandbox",
			"allow-modals",
			"allow-top-navigation",
			"allow-top-navigation-by-user-activation",
			"allow-top-navigation-to-custom-protocols",
			"allow-downloads",
			"allow-pointer-lock",
			"allow-presentation",
			"allow-orientation-lock",
			"allow-storage-access-by-user-activation",
		];
		for (const tok of escapes) {
			expect(BLOCK_FRAME_SANDBOX_TOKENS).not.toContain(tok);
		}
	});

	it("allow attribute is the empty string (no Permissions-Policy features)", () => {
		expect(BLOCK_FRAME_ALLOW).toBe("");
	});

	it("referrer policy is no-referrer", () => {
		expect(BLOCK_FRAME_REFERRER_POLICY).toBe("no-referrer");
	});

	it("loading attribute is lazy", () => {
		expect(BLOCK_FRAME_LOADING).toBe("lazy");
	});

	it("CSP includes every must-have directive", () => {
		const map = new Map(BLOCK_FRAME_CSP_DIRECTIVES);
		expect(map.get("default-src")).toBe("'none'");
		expect(map.get("connect-src")).toBe("'none'");
		expect(map.get("form-action")).toBe("'none'");
		expect(map.get("base-uri")).toBe("'none'");
		expect(map.get("object-src")).toBe("'none'");
		expect(map.get("child-src")).toBe("'none'");
		expect(map.get("frame-src")).toBe("'none'");
		expect(map.get("worker-src")).toBe("'none'");
	});

	it("CSP does NOT include `frame-ancestors` (not enforceable from <meta>; opaque-origin self-blocks)", () => {
		// The directive cannot be enforced via <meta http-equiv> per CSP3
		// AND would self-block a srcdoc opaque-origin doc from rendering
		// inside its (non-opaque) embedder. The sandbox attribute already
		// prevents top-navigation abuse; this is the right call. Pinned so
		// a future contributor cannot accidentally re-add it.
		const map = new Map(BLOCK_FRAME_CSP_DIRECTIVES);
		expect(map.has("frame-ancestors")).toBe(false);
		expect(BLOCK_FRAME_CSP).not.toContain("frame-ancestors");
	});

	it("CSP_DIRECTIVES are deep-frozen — neither the array nor any tuple is mutable", () => {
		expect(Object.isFrozen(BLOCK_FRAME_CSP_DIRECTIVES)).toBe(true);
		for (const tuple of BLOCK_FRAME_CSP_DIRECTIVES) {
			expect(Object.isFrozen(tuple)).toBe(true);
		}
	});

	it("CSP grants ONLY 'unsafe-inline' for script/style and `data:` for images", () => {
		const map = new Map(BLOCK_FRAME_CSP_DIRECTIVES);
		expect(map.get("script-src")).toBe("'unsafe-inline'");
		expect(map.get("style-src")).toBe("'unsafe-inline'");
		expect(map.get("img-src")).toBe("data:");
	});

	it("CSP does NOT allow `'self'`, host allowlists, `blob:`, or `*`", () => {
		const joined = BLOCK_FRAME_CSP;
		expect(joined).not.toContain("'self'");
		expect(joined).not.toContain("blob:");
		expect(joined).not.toMatch(/\*/);
		expect(joined).not.toMatch(/https?:/);
	});

	it("srcdoc contains the CSP meta tag", () => {
		expect(BLOCK_FRAME_SRCDOC).toContain(
			`<meta http-equiv="Content-Security-Policy" content="${BLOCK_FRAME_CSP}">`,
		);
	});

	it("srcdoc has no inline <script> element", () => {
		expect(BLOCK_FRAME_SRCDOC).not.toMatch(/<script/i);
	});

	it("srcdoc pins <base target=_self> to defeat anchor escape if popups regress", () => {
		expect(BLOCK_FRAME_SRCDOC).toContain('<base target="_self">');
	});
});

describe("createBlockFrame — attributes pin the sandbox", () => {
	let container: HTMLElement;
	let handles: BlockFrameHandle[];

	beforeEach(() => {
		container = makeContainer();
		handles = [];
		lastIntersection = null;
		lastResize = null;
	});

	afterEach(() => {
		for (const h of handles) h.destroy();
		container.remove();
	});

	function build(extra: Partial<Parameters<typeof createBlockFrame>[0]> = {}): BlockFrameHandle {
		const h = createBlockFrame({
			container,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
			...extra,
		});
		handles.push(h);
		return h;
	}

	it("creates an iframe element appended to the container", () => {
		const h = build();
		expect(h.iframe.tagName).toBe("IFRAME");
		expect(h.iframe.parentElement).toBe(container);
	});

	it("iframe.sandbox matches BLOCK_FRAME_SANDBOX exactly", () => {
		const h = build();
		expect(h.iframe.getAttribute("sandbox")).toBe(BLOCK_FRAME_SANDBOX);
	});

	it("iframe has srcdoc and NO src attribute", () => {
		const h = build();
		expect(h.iframe.getAttribute("srcdoc")).toBe(BLOCK_FRAME_SRCDOC);
		expect(h.iframe.hasAttribute("src")).toBe(false);
		expect(h.iframe.getAttribute("src")).toBeNull();
	});

	it("iframe.allow is empty string (Permissions-Policy: deny all)", () => {
		const h = build();
		expect(h.iframe.getAttribute("allow")).toBe("");
	});

	it("iframe.referrerpolicy is no-referrer", () => {
		const h = build();
		expect(h.iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
	});

	it("iframe.loading is lazy", () => {
		const h = build();
		expect(h.iframe.getAttribute("loading")).toBe("lazy");
	});

	it("iframe carries the default class plus any extra", () => {
		const h1 = build();
		expect(h1.iframe.getAttribute("class")).toBe(BLOCK_FRAME_DEFAULT_CLASS);
		const h2 = build({ className: "extra" });
		expect(h2.iframe.getAttribute("class")).toBe(`${BLOCK_FRAME_DEFAULT_CLASS} extra`);
	});

	it("iframe optional title attribute lands when provided", () => {
		const h = build({ title: "demo block" });
		expect(h.iframe.getAttribute("title")).toBe("demo block");
	});

	it("scrolling=no + frameborder=0 (no chrome leak)", () => {
		const h = build();
		expect(h.iframe.getAttribute("scrolling")).toBe("no");
		expect(h.iframe.getAttribute("frameborder")).toBe("0");
	});
});

describe("createBlockFrame — input props cannot override security-relevant attributes", () => {
	let container: HTMLElement;
	let handles: BlockFrameHandle[];

	beforeEach(() => {
		container = makeContainer();
		handles = [];
	});
	afterEach(() => {
		for (const h of handles) h.destroy();
		container.remove();
	});

	const SECURITY_ATTRS = ["sandbox", "srcdoc", "allow", "referrerpolicy", "loading"] as const;

	const inputMatrix: Array<Partial<Parameters<typeof createBlockFrame>[0]>> = [
		{},
		{ className: "anything" },
		{ title: "anything" },
		{ className: "foo bar baz", title: "the block" },
	];

	for (const inputs of inputMatrix) {
		it(`fingerprint stable for inputs=${JSON.stringify(inputs)}`, () => {
			const h = createBlockFrame({
				container,
				IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
				ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
				...inputs,
			});
			handles.push(h);
			for (const a of SECURITY_ATTRS) {
				if (a === "sandbox") expect(h.iframe.getAttribute(a)).toBe(BLOCK_FRAME_SANDBOX);
				if (a === "srcdoc") expect(h.iframe.getAttribute(a)).toBe(BLOCK_FRAME_SRCDOC);
				if (a === "allow") expect(h.iframe.getAttribute(a)).toBe(BLOCK_FRAME_ALLOW);
				if (a === "referrerpolicy") expect(h.iframe.getAttribute(a)).toBe(BLOCK_FRAME_REFERRER_POLICY);
				if (a === "loading") expect(h.iframe.getAttribute(a)).toBe(BLOCK_FRAME_LOADING);
			}
			expect(h.iframe.hasAttribute("src")).toBe(false);
		});
	}
});

describe("createBlockFrame — IntersectionObserver pause/resume contract", () => {
	let container: HTMLElement;
	let handles: BlockFrameHandle[];

	beforeEach(() => {
		container = makeContainer();
		handles = [];
		lastIntersection = null;
		lastResize = null;
	});
	afterEach(() => {
		for (const h of handles) h.destroy();
		container.remove();
	});

	function build(onPhase?: (p: BlockFramePhase) => void): BlockFrameHandle {
		const h = createBlockFrame({
			container,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
			...(onPhase ? { onPhase } : {}),
		});
		handles.push(h);
		return h;
	}

	it("starts in Paused (no IntersectionObserver entries delivered yet)", () => {
		const h = build();
		expect(h.getPhase()).toBe(BlockFramePhase.Paused);
	});

	it("observes the iframe element", () => {
		const h = build();
		expect(lastIntersection?.observed).toContain(h.iframe);
	});

	it("transitions to Mounted on first isIntersecting=true entry", () => {
		const onPhase = vi.fn();
		const h = build(onPhase);
		lastIntersection?.fire([{ isIntersecting: true }]);
		expect(h.getPhase()).toBe(BlockFramePhase.Mounted);
		expect(onPhase).toHaveBeenCalledWith(BlockFramePhase.Mounted);
	});

	it("transitions back to Paused on isIntersecting=false", () => {
		const onPhase = vi.fn();
		const h = build(onPhase);
		lastIntersection?.fire([{ isIntersecting: true }]);
		onPhase.mockClear();
		lastIntersection?.fire([{ isIntersecting: false }]);
		expect(h.getPhase()).toBe(BlockFramePhase.Paused);
		expect(onPhase).toHaveBeenCalledWith(BlockFramePhase.Paused);
	});

	it("no duplicate phase callback when entry repeats the current phase", () => {
		const onPhase = vi.fn();
		const h = build(onPhase);
		lastIntersection?.fire([{ isIntersecting: true }]);
		lastIntersection?.fire([{ isIntersecting: true }]);
		lastIntersection?.fire([{ isIntersecting: true }]);
		const visibleCalls = onPhase.mock.calls.filter((c) => c[0] === BlockFramePhase.Mounted).length;
		expect(visibleCalls).toBe(1);
		expect(h.getPhase()).toBe(BlockFramePhase.Mounted);
	});

	it("uses only the LAST entry in a batch (matches IO semantics)", () => {
		const h = build();
		lastIntersection?.fire([{ isIntersecting: true }, { isIntersecting: false }]);
		expect(h.getPhase()).toBe(BlockFramePhase.Paused);
	});

	it("when IntersectionObserver is unavailable, stays Paused (fail-closed for security)", () => {
		// A security primitive must fail closed: an unknown host environment
		// is treated as "not visible, do not deliver" forcing the host to
		// supply a real IntersectionObserver (or run in real Chromium where
		// IO is always present). The prior fail-open default risked an
		// offscreen frame running scripts on hosts where IO was shimmed
		// or missing — flagged by 9.5.1's pentest pass.
		const h = createBlockFrame({
			container,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		handles.push(h);
		expect(h.getPhase()).toBe(BlockFramePhase.Paused);
	});
});

describe("createBlockFrame — ResizeObserver size relay", () => {
	let container: HTMLElement;
	let handles: BlockFrameHandle[];

	beforeEach(() => {
		container = makeContainer();
		handles = [];
		lastIntersection = null;
		lastResize = null;
	});
	afterEach(() => {
		for (const h of handles) h.destroy();
		container.remove();
	});

	it("size starts at 0/0 before any entries", () => {
		const h = createBlockFrame({
			container,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		handles.push(h);
		expect(h.getSize()).toEqual({ width: 0, height: 0 });
	});

	it("observes the container element", () => {
		createBlockFrame({
			container,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		expect(lastResize?.observed).toContain(container);
	});

	it("emits rounded ints on resize entries", () => {
		const onSize = vi.fn();
		const h = createBlockFrame({
			container,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
			onSize,
		});
		handles.push(h);
		lastResize?.fire([{ contentRect: { width: 120.4, height: 64.9 } }]);
		expect(onSize).toHaveBeenCalledWith({ width: 120, height: 65 });
		expect(h.getSize()).toEqual({ width: 120, height: 65 });
	});
});

describe("createBlockFrame — destroy() teardown", () => {
	let container: HTMLElement;
	let handles: BlockFrameHandle[];

	beforeEach(() => {
		container = makeContainer();
		handles = [];
		lastIntersection = null;
		lastResize = null;
	});
	afterEach(() => {
		for (const h of handles) {
			if (!h.isDestroyed()) h.destroy();
		}
		container.remove();
	});

	it("removes the iframe from the DOM", () => {
		const h = createBlockFrame({
			container,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		handles.push(h);
		expect(container.querySelector("iframe")).toBe(h.iframe);
		h.destroy();
		expect(container.querySelector("iframe")).toBeNull();
		expect(h.iframe.parentNode).toBeNull();
	});

	it("disconnects both observers", () => {
		const h = createBlockFrame({
			container,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		h.destroy();
		expect(lastIntersection?.disconnected).toBe(true);
		expect(lastResize?.disconnected).toBe(true);
	});

	it("transitions to Unloaded and fires onPhase once", () => {
		const onPhase = vi.fn();
		const h = createBlockFrame({
			container,
			onPhase,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		onPhase.mockClear();
		h.destroy();
		expect(h.getPhase()).toBe(BlockFramePhase.Unloaded);
		expect(onPhase).toHaveBeenCalledWith(BlockFramePhase.Unloaded);
	});

	it("isDestroyed flips true after destroy", () => {
		const h = createBlockFrame({
			container,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		expect(h.isDestroyed()).toBe(false);
		h.destroy();
		expect(h.isDestroyed()).toBe(true);
	});

	it("is idempotent — second destroy is a no-op (phase callback fires once)", () => {
		const onPhase = vi.fn();
		const h = createBlockFrame({
			container,
			onPhase,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		h.destroy();
		const calls = onPhase.mock.calls.filter((c) => c[0] === BlockFramePhase.Unloaded).length;
		h.destroy();
		h.destroy();
		const callsAfter = onPhase.mock.calls.filter((c) => c[0] === BlockFramePhase.Unloaded).length;
		expect(calls).toBe(1);
		expect(callsAfter).toBe(1);
	});

	it("ignores phase updates after destroy (late IO entries are no-ops)", () => {
		const onPhase = vi.fn();
		const h = createBlockFrame({
			container,
			onPhase,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		h.destroy();
		onPhase.mockClear();
		lastIntersection?.fire([{ isIntersecting: true }]);
		expect(onPhase).not.toHaveBeenCalled();
		expect(h.getPhase()).toBe(BlockFramePhase.Unloaded);
	});

	it("re-mount creates a fresh iframe (no state survives across mounts)", () => {
		const onPhase1 = vi.fn();
		const h1 = createBlockFrame({
			container,
			onPhase: onPhase1,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		handles.push(h1);
		lastIntersection?.fire([{ isIntersecting: true }]);
		const firstIframe = h1.iframe;
		h1.destroy();

		const onPhase2 = vi.fn();
		const h2 = createBlockFrame({
			container,
			onPhase: onPhase2,
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		handles.push(h2);
		expect(h2.iframe).not.toBe(firstIframe);
		expect(h2.getPhase()).toBe(BlockFramePhase.Paused);
		expect(h2.getSize()).toEqual({ width: 0, height: 0 });
	});
});

describe("createBlockFrame — callback safety", () => {
	let container: HTMLElement;
	let handles: BlockFrameHandle[];

	beforeEach(() => {
		container = makeContainer();
		handles = [];
		lastIntersection = null;
		lastResize = null;
	});
	afterEach(() => {
		for (const h of handles) {
			if (!h.isDestroyed()) h.destroy();
		}
		container.remove();
	});

	it("a throwing onPhase callback does not break teardown", () => {
		const h = createBlockFrame({
			container,
			onPhase: () => {
				throw new Error("host crash");
			},
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		handles.push(h);
		expect(() => lastIntersection?.fire([{ isIntersecting: true }])).not.toThrow();
		expect(() => h.destroy()).not.toThrow();
		expect(h.isDestroyed()).toBe(true);
		expect(container.querySelector("iframe")).toBeNull();
	});

	it("a throwing onSize callback does not break teardown", () => {
		const h = createBlockFrame({
			container,
			onSize: () => {
				throw new Error("host crash");
			},
			IntersectionObserverImpl: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
			ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
		});
		handles.push(h);
		expect(() => lastResize?.fire([{ contentRect: { width: 100, height: 50 } }])).not.toThrow();
		expect(() => h.destroy()).not.toThrow();
		expect(h.isDestroyed()).toBe(true);
	});
});
