import { describe, expect, it } from "vitest";
import { runSaveEnrichment } from "./save-enrichment";

describe("runSaveEnrichment", () => {
	it("captures only after the metadata scrape resolves — never concurrently (F-278)", async () => {
		const order: string[] = [];
		let releaseScrape = (): void => {};
		const scrapeGate = new Promise<void>((resolve) => {
			releaseScrape = resolve;
		});

		const pending = runSaveEnrichment(true, {
			scrapeMetadata: async () => {
				order.push("scrape:start");
				await scrapeGate;
				order.push("scrape:end");
			},
			captureContent: async () => {
				order.push("capture:start");
			},
		});

		// While the scrape is still in-flight, capture must not have begun.
		await Promise.resolve();
		expect(order).toEqual(["scrape:start"]);

		releaseScrape();
		await pending;
		expect(order).toEqual(["scrape:start", "scrape:end", "capture:start"]);
	});

	it("skips capture entirely when downloadContent is off", async () => {
		const order: string[] = [];
		await runSaveEnrichment(false, {
			scrapeMetadata: async () => {
				order.push("scrape");
			},
			captureContent: async () => {
				order.push("capture");
			},
		});
		expect(order).toEqual(["scrape"]);
	});

	it("still captures after a scrape that resolves without effect", async () => {
		const order: string[] = [];
		await runSaveEnrichment(true, {
			scrapeMetadata: async () => {
				order.push("scrape");
			},
			captureContent: async () => {
				order.push("capture");
			},
		});
		expect(order).toEqual(["scrape", "capture"]);
	});
});
