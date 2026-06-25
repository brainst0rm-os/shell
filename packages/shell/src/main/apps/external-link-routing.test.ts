import { describe, expect, it } from "vitest";
import {
	type RoutableWebContents,
	isRoutableExternalUrl,
	wireExternalLinkRouting,
} from "./external-link-routing";

type OpenHandler = (details: { url: string }) => { action: "deny" };

function fakeWebContents(options: { withOpenHandler?: boolean } = {}) {
	const withOpenHandler = options.withOpenHandler ?? true;
	let openHandler: OpenHandler | null = null;
	const listeners = new Map<string, (...args: unknown[]) => void>();
	const wc: RoutableWebContents = {
		on: (event, listener) => {
			listeners.set(event, listener);
		},
	};
	if (withOpenHandler) {
		wc.setWindowOpenHandler = (handler) => {
			openHandler = handler;
		};
	}
	return {
		wc,
		openWindow: (url: string) => openHandler?.({ url }) ?? null,
		navigate: (url: string) => {
			let prevented = false;
			const preventDefault = () => {
				prevented = true;
			};
			listeners.get("will-navigate")?.({ preventDefault }, url);
			return prevented;
		},
	};
}

describe("isRoutableExternalUrl", () => {
	it("accepts http and https in any case", () => {
		expect(isRoutableExternalUrl("https://example.com")).toBe(true);
		expect(isRoutableExternalUrl("http://example.com/a?b=1")).toBe(true);
		expect(isRoutableExternalUrl("HTTPS://EXAMPLE.COM")).toBe(true);
	});

	it("rejects non-web schemes", () => {
		expect(isRoutableExternalUrl("file:///etc/passwd")).toBe(false);
		expect(isRoutableExternalUrl("javascript:alert(1)")).toBe(false);
		expect(isRoutableExternalUrl("mailto:a@b.c")).toBe(false);
		expect(isRoutableExternalUrl("brainstorm://entity/ent_1")).toBe(false);
		expect(isRoutableExternalUrl("not a url")).toBe(false);
	});
});

describe("wireExternalLinkRouting", () => {
	it("denies window.open and routes web URLs", () => {
		const routed: string[] = [];
		const fake = fakeWebContents();
		wireExternalLinkRouting(fake.wc, (url) => routed.push(url));
		expect(fake.openWindow("https://example.com")).toEqual({ action: "deny" });
		expect(routed).toEqual(["https://example.com"]);
	});

	it("denies window.open without routing non-web URLs", () => {
		const routed: string[] = [];
		const fake = fakeWebContents();
		wireExternalLinkRouting(fake.wc, (url) => routed.push(url));
		expect(fake.openWindow("file:///etc/passwd")).toEqual({ action: "deny" });
		expect(fake.openWindow("javascript:alert(1)")).toEqual({ action: "deny" });
		expect(routed).toEqual([]);
	});

	it("prevents will-navigate and routes web URLs", () => {
		const routed: string[] = [];
		const fake = fakeWebContents();
		wireExternalLinkRouting(fake.wc, (url) => routed.push(url));
		expect(fake.navigate("https://example.com")).toBe(true);
		expect(routed).toEqual(["https://example.com"]);
	});

	it("prevents will-navigate silently for non-web URLs", () => {
		const routed: string[] = [];
		const fake = fakeWebContents();
		wireExternalLinkRouting(fake.wc, (url) => routed.push(url));
		expect(fake.navigate("file:///somewhere")).toBe(true);
		expect(routed).toEqual([]);
	});

	it("still wires will-navigate when setWindowOpenHandler is absent", () => {
		const routed: string[] = [];
		const fake = fakeWebContents({ withOpenHandler: false });
		expect(() => wireExternalLinkRouting(fake.wc, (url) => routed.push(url))).not.toThrow();
		expect(fake.navigate("https://example.com")).toBe(true);
		expect(routed).toEqual(["https://example.com"]);
	});
});
