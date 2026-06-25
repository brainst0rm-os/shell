/**
 * Extraction utility worker (Net-2b) — runs the CPU-heavy readable-extraction
 * core (Net-2a: Readability parse + sanitize + HTML→blocks) off the network-
 * broker main-process event loop (OQ-RX-3). Mirrors the storage / ydoc worker
 * layout: an envelope protocol over `process.parentPort`, with the listener
 * gated on `parentPort` presence so Vitest exercises `handleExtractionEnvelope`
 * directly (no fork).
 *
 * Pure of Electron + network: it only transforms the HTML bytes the main
 * process already fetched (every Net-1 egress invariant was enforced on the
 * fetch leg). No second network access, no DOM globals.
 */

import type { Envelope, EnvelopeReply } from "../../ipc/envelope";
import { makeErrorReply, makeOkReply, validateEnvelope } from "../../ipc/envelope";
import { extractReadable } from "../../main/network/readable/extract-html";
import type { ReadableMeta } from "../../main/network/readable/extract-html";
import { htmlToSerializedBlocks } from "../../main/network/readable/html-to-blocks";
import type { SerializedBlock } from "../../main/network/readable/html-to-blocks";
import { sanitizeReadableHtml } from "../../main/network/readable/sanitize-html";
import { installWorkerProcessGuards, wireParentPort } from "../worker-runtime";

/** See storage/index.ts — `parentPort` delivers a `MessageEvent`-shaped object;
 *  the payload is on `.data` (asymmetric with the parent's `.on('message')`). */
type ParentPortMessage = { data: unknown };
type ParentPort = {
	on(event: "message", listener: (event: ParentPortMessage) => void): void;
	postMessage(message: unknown): void;
};
type ProcessWithParentPort = NodeJS.Process & { parentPort?: ParentPort };

/** What the worker returns for an `extract` call. `blocks: null` (and
 *  `meta: null`) means the page had no extractable article — the caller falls
 *  back to metadata-only. */
export type ExtractionResult = {
	meta: ReadableMeta | null;
	blocks: SerializedBlock[] | null;
	textContent: string;
};

const NO_ARTICLE: ExtractionResult = { meta: null, blocks: null, textContent: "" };

type Handler = (envelope: Envelope) => Promise<unknown> | unknown;

const handlers: Record<string, Handler> = {
	ping: (envelope) => ({ pong: envelope.args[0] ?? null }),

	/** Compose the three Net-2a pure modules: isolate the article, sanitize it,
	 *  convert it to Lexical blocks. The HTML comes from the main process's
	 *  already-audited fetch. */
	extract: (envelope) => {
		const input = envelope.args[0];
		const html =
			input && typeof input === "object" && typeof (input as { html?: unknown }).html === "string"
				? (input as { html: string }).html
				: "";
		const baseUrl =
			input &&
			typeof input === "object" &&
			typeof (input as { baseUrl?: unknown }).baseUrl === "string"
				? (input as { baseUrl: string }).baseUrl
				: "";

		const article = extractReadable(html, baseUrl);
		if (article === null) return NO_ARTICLE;
		const blocks = htmlToSerializedBlocks(sanitizeReadableHtml(article.html));
		return {
			meta: article.meta,
			blocks,
			textContent: article.textContent,
		} satisfies ExtractionResult;
	},
};

export async function handleExtractionEnvelope(raw: unknown): Promise<EnvelopeReply> {
	const validation = validateEnvelope(raw);
	if (!validation.ok) {
		return makeErrorReply(messageIdOrFallback(raw), {
			kind: "Invalid",
			message: validation.reason,
		});
	}
	const envelope = validation.envelope;
	if (envelope.service !== "extraction") {
		return makeErrorReply(envelope.msg, {
			kind: "Invalid",
			message: `wrong service routed to extraction worker: ${envelope.service}`,
		});
	}
	const handler = handlers[envelope.method];
	if (!handler) {
		return makeErrorReply(envelope.msg, {
			kind: "Unavailable",
			message: `extraction method not implemented: ${envelope.method}`,
			method: envelope.method,
		});
	}
	try {
		return makeOkReply(envelope.msg, await handler(envelope));
	} catch (error) {
		return makeErrorReply(envelope.msg, errorPayload(error));
	}
}

function messageIdOrFallback(raw: unknown): string {
	if (raw && typeof raw === "object") {
		const m = (raw as { msg?: unknown }).msg;
		if (typeof m === "string" && m.length > 0 && m.length <= 128) return m;
	}
	return "unknown";
}

function errorPayload(error: unknown): { kind: string; message: string } {
	if (error instanceof Error) return { kind: error.name || "Error", message: error.message };
	return { kind: "Error", message: String(error) };
}

/** Unwrap the `parentPort` `MessageEvent` then route. Exported so the wiring is
 *  unit-testable (the inline `port.on` block isn't reachable from Vitest). */
export function handleParentPortMessage(event: ParentPortMessage): Promise<EnvelopeReply> {
	return handleExtractionEnvelope(event.data);
}

installWorkerProcessGuards("extraction");
wireParentPort(
	"extraction",
	handleParentPortMessage,
	(process as ProcessWithParentPort).parentPort,
);
