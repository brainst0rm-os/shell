/**
 * Broker service handler for `blocks` (9.11) — the capability-gated,
 * app-reachable face of the block-id → providing-app registry.
 *
 * Methods (read-only; the host owns registration — blocks are declared
 * in a manifest's `registrations.blocks` and written on install, never
 * by an app at runtime):
 *   - list()                 → BlockInfo[]            (every registered block)
 *   - resolve({ blockId })   → BlockInfo | null       (which app renders it)
 *   - source({ blockId })    → string | null          (the block bundle IIFE)
 *   - forType({ entityType })→ string | null          (block id for a type)
 *
 * Capability gating happens in the broker via the envelope's `caps`
 * field; the SDK proxy declares `blocks.read` for both methods. Throws
 * `Unavailable` when no vault session is active, `Invalid` on malformed
 * args / unknown methods. A well-formed but unregistered block id
 * resolves to `null` (not an error) — "unknown block" is a normal
 * answer for the `BlockEmbedNode` lookup.
 *
 * Thin on purpose: the grammar lives in the shared `apps/block-id`
 * keystone and the lookup in `BlocksRepository`, so this is pure
 * dispatch + arg validation — easy to security-review as a new
 * app-reachable surface.
 */

import type { ServiceHandler } from "../../ipc/broker";
import type { Envelope } from "../../ipc/envelope";
import { isValidBlockId } from "../apps/block-id";
import type { BlockRecord, BlocksRepository } from "../storage/registry-repo/blocks-repo";

export type BlocksServiceOptions = {
	/** The active vault's blocks repo, or null when no session is open
	 *  (→ Unavailable). Async to mirror the entities-repo accessor —
	 *  `registry.db` is opened lazily + cached by `DataStores`. */
	getBlocksRepo: () => Promise<BlocksRepository | null>;
};

function invalid(message: string): Error {
	const err = new Error(message);
	err.name = "Invalid";
	return err;
}

function unavailable(message: string): Error {
	const err = new Error(message);
	err.name = "Unavailable";
	return err;
}

async function requireRepo(options: BlocksServiceOptions): Promise<BlocksRepository> {
	const repo = await options.getBlocksRepo();
	if (!repo) throw unavailable("blocks: no active vault session");
	return repo;
}

function requireBlockId(envelope: Envelope): string {
	const [arg] = envelope.args as [unknown];
	if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
		throw invalid("blocks.resolve: argument must be an object");
	}
	const blockId = (arg as Record<string, unknown>).blockId;
	if (typeof blockId !== "string" || blockId.length === 0) {
		throw invalid("blocks.resolve: blockId must be a non-empty string");
	}
	if (!isValidBlockId(blockId)) {
		throw invalid("blocks.resolve: blockId must be <app-id>/<block-name>");
	}
	return blockId;
}

function requireEntityType(envelope: Envelope): string {
	const [arg] = envelope.args as [unknown];
	if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
		throw invalid("blocks.forType: argument must be an object");
	}
	const entityType = (arg as Record<string, unknown>).entityType;
	if (typeof entityType !== "string" || entityType.length === 0) {
		throw invalid("blocks.forType: entityType must be a non-empty string");
	}
	return entityType;
}

export function makeBlocksServiceHandler(options: BlocksServiceOptions): ServiceHandler {
	return async (envelope: Envelope): Promise<unknown> => {
		switch (envelope.method) {
			case "list": {
				const repo = await requireRepo(options);
				return repo.listAll();
			}
			case "resolve": {
				const repo = await requireRepo(options);
				const blockId = requireBlockId(envelope);
				const record: BlockRecord | null = repo.getById(blockId);
				return record;
			}
			case "source": {
				// The app-contributed block bundle (IIFE string) the embedding
				// app inlines into the sandboxed block frame. Same `blocks.read`
				// gate + grammar validation as `resolve`. `null` = no bundle
				// (unknown block, or a registered block that ships none → the
				// embed stays a fallback card).
				const repo = await requireRepo(options);
				const blockId = requireBlockId(envelope);
				return repo.getSource(blockId);
			}
			case "forType": {
				// "Which block renders this entity type?" — the embed-insert path
				// asks this to pick the live block over the generic shell card.
				// `null` when no block claims the type. `blocks.read` gate.
				const repo = await requireRepo(options);
				return repo.forType(requireEntityType(envelope));
			}
			default:
				throw invalid(`unknown blocks method: ${envelope.method}`);
		}
	};
}
