import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "../../ipc/envelope";
import { UiNotifyHost } from "./notify-host";
import { TrayHost } from "./tray-host";
import { makeUiServiceHandler } from "./ui-service";

function envelope(method: string, app = "io.example.app", ...args: unknown[]): Envelope {
	return { v: 1, msg: "m1", app, service: "ui", method, args, caps: ["notifications.post"] };
}

function handlerWith(host = new UiNotifyHost(), tray = new TrayHost()) {
	return {
		handler: makeUiServiceHandler({ getHost: () => host, getTrayHost: () => tray }),
		host,
		tray,
	};
}

describe("makeUiServiceHandler — notify", () => {
	it("normalises + forwards a notify call to the host, stamping the envelope app", () => {
		const { handler, host } = handlerWith();
		const post = vi
			.spyOn(host, "post")
			.mockReturnValue({ recorded: true, osNotified: false, suppressed: false, deduped: false });

		const result = handler(
			envelope("notify", "io.example.tasks", { title: "Saved", kind: "success" }),
		);

		expect(result).toBeUndefined();
		expect(post).toHaveBeenCalledWith({
			appId: "io.example.tasks",
			title: "Saved",
			kind: "success",
		});
	});

	it("throws Invalid on a malformed payload (no title)", () => {
		const { handler } = handlerWith();
		expect(() => handler(envelope("notify", "a", {}))).toThrowError(
			expect.objectContaining({ name: "Invalid" }),
		);
	});

	it("throws Invalid for an unknown method", () => {
		const { handler } = handlerWith();
		expect(() => handler(envelope("openWindow", "a", { windowId: "w" }))).toThrowError(
			expect.objectContaining({ name: "Invalid" }),
		);
	});
});

describe("makeUiServiceHandler — tray", () => {
	it("publishes a validated section under the envelope app", () => {
		const { handler, tray } = handlerWith();
		const publish = vi.spyOn(tray, "publish");
		const spec = { items: [{ id: "new", label: "New note" }] };

		const result = handler(envelope("tray.publish", "io.example.notes", spec));

		expect(result).toBeUndefined();
		expect(publish).toHaveBeenCalledWith("io.example.notes", spec);
		expect(tray.compose()?.entries).toContainEqual(
			expect.objectContaining({ kind: "item", appId: "io.example.notes", label: "New note" }),
		);
	});

	it("throws Invalid on a malformed tray spec", () => {
		const { handler } = handlerWith();
		expect(() => handler(envelope("tray.publish", "a", { items: [] }))).toThrowError(
			expect.objectContaining({ name: "Invalid" }),
		);
	});

	it("clears the calling app's section", () => {
		const { handler, tray } = handlerWith();
		handler(envelope("tray.publish", "a", { items: [{ id: "x", label: "X" }] }));
		expect(tray.compose()).not.toBeNull();
		handler(envelope("tray.clear", "a"));
		expect(tray.compose()).toBeNull();
	});
});

describe("makeUiServiceHandler — openSearch (9.8.9)", () => {
	function searchHandler() {
		const opened: string[] = [];
		const handler = makeUiServiceHandler({
			getHost: () => new UiNotifyHost(),
			getTrayHost: () => new TrayHost(),
			openSearch: (query) => opened.push(query),
		});
		return { handler, opened };
	}

	it("forwards the query to the injected opener", () => {
		const { handler, opened } = searchHandler();
		expect(handler(envelope("openSearch", "io.brainstorm.files", { query: "report" }))).toBe(
			undefined,
		);
		expect(opened).toEqual(["report"]);
	});

	it("degrades a missing / non-string query to an empty palette open", () => {
		const { handler, opened } = searchHandler();
		handler(envelope("openSearch", "a", {}));
		handler(envelope("openSearch", "a", { query: 42 }));
		handler(envelope("openSearch", "a"));
		expect(opened).toEqual(["", "", ""]);
	});

	it("clamps an oversized query instead of pumping it through", () => {
		const { handler, opened } = searchHandler();
		handler(envelope("openSearch", "a", { query: "x".repeat(10_000) }));
		expect(opened[0]?.length).toBe(512);
	});

	it("throws Unavailable when no opener is wired", () => {
		const { handler } = handlerWith();
		expect(() => handler(envelope("openSearch", "a", { query: "q" }))).toThrowError(
			expect.objectContaining({ name: "Unavailable" }),
		);
	});
});
