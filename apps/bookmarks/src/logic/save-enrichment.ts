/**
 * Post-save background enrichment orchestration for a freshly-added bookmark.
 *
 * The metadata scrape (`network.preview`) and the readable-content capture
 * (`network.readable`) each issue an `entities.db` write — and the scrape also
 * stores the favicon + cover as encrypted assets on that same connection.
 * Firing them concurrently lands several writes on the shared connection at
 * once, which contends on the WAL write lock under load: the `database is
 * locked` / ~5s-stall path (F-278). Running them in series — scrape first,
 * capture only after it resolves — keeps the add to one in-flight enrichment
 * write at a time, off the contention path.
 *
 * Both steps own their error handling (they resolve, never reject), so a failed
 * scrape can't break the chain.
 */
export async function runSaveEnrichment(
	downloadContent: boolean,
	steps: {
		scrapeMetadata: () => Promise<void>;
		captureContent: () => Promise<void>;
	},
): Promise<void> {
	await steps.scrapeMetadata();
	if (downloadContent) await steps.captureContent();
}
