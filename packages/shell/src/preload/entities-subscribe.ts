/**
 * 9.12.5 — `entities.subscribe(query, onUpdate)` push subscriptions,
 * layered over the payload-free `app:vault-entities-changed` staleness
 * broadcast + a broker-validated re-query.
 *
 * The SDK proxy ships a no-op default and documents exactly this overlay:
 * the preload listens to the staleness channel and, per live subscription,
 * re-runs the app's own `entities.query` THROUGH THE BROKER — so the
 * capability check re-runs on every push and the broadcast itself never
 * carries authority (the same discipline as `vaultEntities.onChange` /
 * `properties.onChange`). Results are de-duplicated by an
 * `id:updatedAt` signature so a write that doesn't touch a subscription's
 * result set fires nothing, and re-queries per subscription are coalesced:
 * a signal arriving while one is in flight queues exactly one trailing
 * re-query instead of stacking.
 *
 * Pure + dependency-free (preloads must stay import-light — a second
 * Rollup chunk breaks the sandboxed preload's `require`): the IPC wiring
 * stays in `app-preload.ts`, this module owns the testable mechanics.
 */

type EntityLike = { id: string; updatedAt: number };

export type EntitySubscriptionHub<Q, E extends EntityLike> = {
	/** Register a subscription: fires `onUpdate` with the initial result,
	 *  then again after any staleness signal that changed the result set.
	 *  Returns the unsubscribe. */
	subscribe(query: Q, onUpdate: (entities: E[]) => void): { unsubscribe: () => void };
	/** The staleness-channel hook — re-queries every live subscription. */
	notifyChanged(): void;
	/** Live subscription count (test / diagnostics surface). */
	size(): number;
};

/** Cheap result-set identity: ids + updatedAt cover create / update /
 *  delete (the entities service bumps `updatedAt` on every patch). */
export function resultSignature(entities: ReadonlyArray<EntityLike>): string {
	return entities.map((e) => `${e.id}:${e.updatedAt}`).join("\n");
}

export function createEntitySubscriptionHub<Q, E extends EntityLike>(
	runQuery: (query: Q) => Promise<E[]>,
	onError: (error: unknown) => void = () => undefined,
): EntitySubscriptionHub<Q, E> {
	type Sub = {
		query: Q;
		onUpdate: (entities: E[]) => void;
		lastSignature: string | null;
		inFlight: boolean;
		pending: boolean;
		live: boolean;
	};

	const subs = new Set<Sub>();

	const pump = async (sub: Sub): Promise<void> => {
		if (sub.inFlight) {
			sub.pending = true;
			return;
		}
		sub.inFlight = true;
		try {
			do {
				sub.pending = false;
				const entities = await runQuery(sub.query);
				if (!sub.live) return;
				const signature = resultSignature(entities);
				if (signature !== sub.lastSignature) {
					sub.lastSignature = signature;
					try {
						sub.onUpdate(entities);
					} catch (error) {
						onError(error);
					}
				}
			} while (sub.pending && sub.live);
		} catch (error) {
			onError(error);
		} finally {
			sub.inFlight = false;
		}
	};

	return {
		subscribe(query, onUpdate) {
			const sub: Sub = {
				query,
				onUpdate,
				lastSignature: null,
				inFlight: false,
				pending: false,
				live: true,
			};
			subs.add(sub);
			void pump(sub);
			return {
				unsubscribe: () => {
					sub.live = false;
					subs.delete(sub);
				},
			};
		},
		notifyChanged() {
			for (const sub of subs) void pump(sub);
		},
		size() {
			return subs.size;
		},
	};
}
