/**
 * Bridge — the IPC transport the SDK runtime uses to talk to the main process.
 *
 * In production this is implemented by the app preload script using Electron's
 * `ipcRenderer.invoke("broker:dispatch", envelope)`. Tests swap in a fake
 * bridge that calls the broker directly.
 *
 * The bridge is intentionally tiny: send-an-envelope, get-a-reply. Any service
 * proxy can be built on top of this.
 */

/**
 * Reply shape (matches `EnvelopeReply` from the shell side). Imported by name
 * here so the SDK package stays decoupled from the shell's broker code.
 */
export type BridgeReply =
	| { ok: true; value: unknown }
	| { ok: false; error: { kind: string; message: string; [detail: string]: unknown } };

export type BridgeEnvelope = {
	service: string;
	method: string;
	args: unknown[];
	caps: string[];
};

export type Bridge = {
	/** App identity stamped by the preload. Read-only from app code. */
	readonly app: string;
	/** Send one envelope; returns the reply. Never throws — errors are encoded. */
	dispatch(envelope: BridgeEnvelope): Promise<BridgeReply>;
};

/**
 * Mint a correlation id for an outgoing envelope. The SDK runs in a sandboxed
 * Electron preload that cannot `require("node:crypto")`, so we avoid `ulid` /
 * any node-built-in deps here. `crypto.getRandomValues` is available in every
 * renderer + worker context the SDK targets; for tests / Node-only callers we
 * fall back to `Math.random` (collisions are immaterial — correlation ids only
 * need to be unique within the in-flight set for one bridge).
 */
let messageCounter = 0;
export function newMessageId(): string {
	messageCounter = (messageCounter + 1) >>> 0;
	const t = Date.now().toString(36);
	const c = messageCounter.toString(36);
	const r = randomToken();
	return `m_${t}_${c}_${r}`;
}

function randomToken(): string {
	const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
	const buf = new Uint8Array(8);
	if (g.crypto?.getRandomValues) {
		g.crypto.getRandomValues(buf);
	} else {
		for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
	}
	let out = "";
	for (let i = 0; i < buf.length; i++) {
		const v = buf[i] ?? 0;
		out += v.toString(36).padStart(2, "0");
	}
	return out;
}
