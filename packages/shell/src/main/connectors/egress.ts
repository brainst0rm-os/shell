/**
 * Connector framework — the single outbound-HTTP seam.
 *
 * Both the OAuth broker's token exchange (Connector-2) and
 * `connectors.request` (Connector-3) egress through this port. Production
 * binds it to Net-1's `executeNetworkFetch` so every connector request
 * inherits the SSRF guard, size/time caps, and the per-host audit log
 * (Settings → Privacy → Network) for free — there is no second egress
 * path. Tests inject a stub that replays canned responses.
 */

import { type ExecuteOptions, executeNetworkFetch } from "../network/network-service";

export type ConnectorEgressRequest = {
	readonly url: string;
	readonly method?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: Uint8Array;
};

export type ConnectorEgressResponse = {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Uint8Array;
	readonly finalUrl: string;
};

export type ConnectorEgress = (req: ConnectorEgressRequest) => Promise<ConnectorEgressResponse>;

/** Production egress: every connector request rides Net-1's
 *  `executeNetworkFetch`, so it inherits the SSRF guard, size/time caps,
 *  and the per-host audit log. The `appId` namespaces the audit entries so
 *  Settings → Privacy → Network attributes traffic to the connector. */
export function makeNetworkEgress(opts: {
	executeOptions: ExecuteOptions;
	appId: string;
}): ConnectorEgress {
	return async (req) => {
		const response = await executeNetworkFetch(
			{
				appId: opts.appId,
				url: req.url,
				...(req.method !== undefined ? { method: req.method } : {}),
				...(req.headers !== undefined ? { headers: { ...req.headers } } : {}),
				...(req.body !== undefined ? { body: req.body } : {}),
			},
			opts.executeOptions,
		);
		return {
			status: response.status,
			headers: response.headers,
			body: response.body,
			finalUrl: response.finalUrl,
		};
	};
}

/** Decode a JSON egress response body. Throws on non-2xx or unparseable
 *  JSON so callers don't silently treat an error page as a token. */
export function decodeJsonResponse<T>(response: ConnectorEgressResponse, context: string): T {
	const text = new TextDecoder("utf-8", { fatal: false }).decode(response.body);
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`${context}: provider returned ${response.status}: ${text.slice(0, 256)}`);
	}
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(`${context}: provider response was not JSON`);
	}
}

/** Encode a record as `application/x-www-form-urlencoded` bytes — the wire
 *  format OAuth token endpoints expect for the code/refresh exchange. */
export function encodeForm(fields: Readonly<Record<string, string>>): Uint8Array {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(fields)) params.set(k, v);
	return new TextEncoder().encode(params.toString());
}
