/**
 * Vault-properties Yjs doc (Stage 10.5a, OQ-199). A sibling of
 * `dashboard-store.ts` — one Y.Doc per vault, held under `meta.*` keys for
 * vault-level state that isn't dashboard layout. Today's only consumer is
 * `pairing/devices-store.ts` (the `meta.devices` Y.Array of signed
 * add-device records).
 *
 * Why a sibling doc rather than reusing `brainstorm-Dashboard`:
 *
 *   - The dashboard doc carries appearance + icons + widgets + handlers etc.
 *     and is broadcast to renderers on every dashboard mutation. Pairing
 *     state is privileged + low-frequency; sharing the broadcast envelope
 *     means a `meta.devices` append would notify every dashboard subscriber
 *     (none of which read it), and a third party with a `dashboard.read`
 *     subscription path would see device-set churn timing.
 *
 *   - The dashboard doc is migrating to `brainstorm/Dashboard/v1` in
 *     Stage 9; keeping pairing state in a separate doc lets that
 *     promotion happen without touching the pairing schema.
 *
 *   - The two docs have completely different on-wire futures: dashboard
 *     stays vault-local-only; the vault-properties doc carries
 *     `meta.devices` which IS replicated across paired devices via the
 *     same sync transport every entity doc uses (10.4 WebSocket relay).
 *
 * Persists via `YDocStore` at the fixed id `brainstorm-VaultProperties`
 * (file lands at `<vault>/data/docs/bra/brainstorm-VaultProperties.ydoc`).
 *
 * Pure module (no Electron imports) so it's testable under Bun's vitest.
 */

import type * as Y from "yjs";
import { DevicesStore } from "../pairing/devices-store";
import type { YDocStore } from "../storage/ydoc-store";

export const VAULT_PROPERTIES_DOC_ID = "brainstorm-VaultProperties";

export type VaultPropertiesStoreOptions = {
	docId?: string;
};

export class VaultPropertiesStore {
	private readonly doc: Y.Doc;
	private readonly yStore: YDocStore;
	private readonly docId: string;
	private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
	private pendingPersist: Promise<void> = Promise.resolve();
	private closed = false;
	private cachedDevices: DevicesStore | null = null;

	private constructor(doc: Y.Doc, yStore: YDocStore, docId: string) {
		this.doc = doc;
		this.yStore = yStore;
		this.docId = docId;
	}

	static async open(
		yStore: YDocStore,
		options: VaultPropertiesStoreOptions = {},
	): Promise<VaultPropertiesStore> {
		const docId = options.docId ?? VAULT_PROPERTIES_DOC_ID;
		const { doc } = await yStore.load(docId);
		const store = new VaultPropertiesStore(doc, yStore, docId);
		// Wire observers FIRST so the schema-init update is persisted (the
		// dashboard/properties stores follow the same contract: any post-load
		// mutation must be visible to the persister). The `meta.devices`
		// array is created on first mutation by DevicesStore.ensureRoot,
		// not here — keeps a freshly-opened doc with no devices truly empty
		// on disk.
		store.wireObservers();
		return store;
	}

	private wireObservers(): void {
		const handler = (update: Uint8Array, origin: unknown) => {
			if (origin === "load") return;
			this.pendingPersist = this.pendingPersist.then(async () => {
				if (this.closed) return;
				await this.yStore.appendAndMaybeCompact(this.docId, update);
			});
		};
		this.updateHandler = handler;
		this.doc.on("update", handler);
	}

	/** Lazily-constructed `DevicesStore` backed by this vault-properties doc.
	 *  Repeat calls return the same instance — the store is stateless on top
	 *  of the Y.Doc, but a single instance keeps `==` checks honest. */
	devices(): DevicesStore {
		if (!this.cachedDevices) {
			this.cachedDevices = new DevicesStore(this.doc);
		}
		return this.cachedDevices;
	}

	/** Expose the raw Y.Doc for advanced consumers (sync wire path; tests).
	 *  Outside of tests, prefer `devices()` and any future typed accessor. */
	get yDoc(): Y.Doc {
		return this.doc;
	}

	async flush(): Promise<void> {
		await this.pendingPersist;
	}

	async close(): Promise<void> {
		this.closed = true;
		if (this.updateHandler) {
			this.doc.off("update", this.updateHandler);
			this.updateHandler = null;
		}
		this.cachedDevices = null;
		await this.pendingPersist;
	}
}
