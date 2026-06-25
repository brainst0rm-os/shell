/**
 * Net-1a — SSRF (Server-Side Request Forgery) hardening primitive for the
 * shell-mediated network broker.
 *
 * The broker's job is to accept app-originated network requests and
 * execute them from the main process so the renderer never sees the
 * target host or the user's IP. Any of those requests can be an SSRF
 * attempt — a malicious or compromised app crafting a URL that resolves
 * to the user's own LAN, cloud-metadata endpoints (169.254.169.254),
 * private internal services, or the loopback interface. The broker MUST
 * validate every URL twice:
 *
 *   1. **Pre-DNS** (`checkUrl`) — scheme + URL shape + literal IP/host
 *      patterns (`localhost`, `*.local`, IDN punycode that decodes to a
 *      private hostname). Catches the obvious cases without spending a
 *      DNS query on input that's already invalid.
 *   2. **Post-DNS** (`checkResolvedIp`) — every IP the hostname resolves
 *      to is checked against the private-range blocklist. DNS rebinding
 *      attacks return a public IP at validation time and a private IP at
 *      fetch time; the broker pins the IP it validated and connects to
 *      THAT IP (not re-resolving), and the caller can recheck on every
 *      redirect.
 *
 * Both validators are PURE — no network, no DNS, no fs. They return a
 * tagged result, never throw. The broker centralises the throw shape so
 * the IPC layer's error mapping (per `intents-bus` precedent) stays
 * consistent.
 *
 * Block-list source of truth (IANA + RFC 6890 +
 * https://www.iana.org/assignments/iana-ipv4-special-registry/
 * https://www.iana.org/assignments/iana-ipv6-special-registry/):
 *
 *   - **IPv4**: 0.0.0.0/8 (this network), 10.0.0.0/8 (private),
 *     100.64.0.0/10 (CGNAT), 127.0.0.0/8 (loopback),
 *     169.254.0.0/16 (link-local incl. cloud metadata),
 *     172.16.0.0/12 (private), 192.0.0.0/24 (IETF protocol),
 *     192.0.2.0/24 (TEST-NET-1), 192.168.0.0/16 (private),
 *     198.18.0.0/15 (benchmarking), 198.51.100.0/24 (TEST-NET-2),
 *     203.0.113.0/24 (TEST-NET-3), 224.0.0.0/4 (multicast),
 *     240.0.0.0/4 (reserved), 255.255.255.255 (broadcast).
 *   - **IPv6**: ::/128 (unspecified), ::1/128 (loopback),
 *     ::ffff:0:0/96 (IPv4-mapped — every entry checked against the IPv4
 *     rules above), 64:ff9b::/96 (IPv4/IPv6 translation),
 *     100::/64 (discard), fc00::/7 (unique local), fe80::/10 (link-local),
 *     ff00::/8 (multicast), 2001:db8::/32 (documentation).
 */

export enum SsrfRejection {
	/** Scheme is not http or https (file:, data:, javascript:, blob:, etc.). */
	NonHttpScheme = "non-http-scheme",
	/** URL constructor rejected the input string. */
	MalformedUrl = "malformed-url",
	/** Hostname was empty or whitespace-only. */
	EmptyHost = "empty-host",
	/** Hostname is a literal that resolves to a loopback / local-only address
	 *  without a DNS query (`localhost`, `*.local`, `*.localhost`). */
	LocalHostname = "local-hostname",
	/** Hostname is an IDN whose ToASCII / punycode decode failed. */
	IdnDecodeFailed = "idn-decode-failed",
	/** The URL's port is on the broker's blocked-port list (SSH, SMTP, FTP,
	 *  POP, IMAP, etc. — protocols that can do destructive things via raw
	 *  HTTP request smuggling). */
	BlockedPort = "blocked-port",
	/** The resolved IPv4 / IPv6 lies in a private, loopback, link-local,
	 *  multicast, reserved, or documentation range. */
	PrivateIp = "private-ip",
	/** The resolved IP could not be parsed as a valid IPv4 / IPv6 literal. */
	MalformedIp = "malformed-ip",
}

/** Tagged result returned by every checker. Never throws. */
export type SsrfCheck =
	| {
			readonly ok: true;
			/** Lower-cased + IDN-normalised hostname (or IP literal). */
			readonly hostname: string;
			/** The URL re-serialised after parsing — caller uses this as
			 *  the canonical request target. */
			readonly canonicalUrl: string;
			/** Port the request will hit (default for the scheme if absent). */
			readonly port: number;
	  }
	| {
			readonly ok: false;
			readonly reason: SsrfRejection;
			readonly detail: string;
	  };

/** Ports the broker refuses to connect to even on a public IP. Catches
 *  request-smuggling vectors against non-HTTP services on the same host
 *  (e.g. POST to an SSH banner). The list is permissive enough that real
 *  HTTPS services on alternate ports (8080, 8443, 3000, …) still work. */
const BLOCKED_PORTS: ReadonlySet<number> = new Set([
	1, // tcpmux
	7, // echo
	9, // discard
	13, // daytime
	19, // chargen
	22, // SSH
	23, // telnet
	25, // SMTP
	53, // DNS (UDP, but TCP smuggling matters)
	69, // TFTP
	79, // finger
	110, // POP3
	119, // NNTP
	123, // NTP
	135, // RPC
	137, // NetBIOS-NS
	139, // NetBIOS-SSN
	143, // IMAP
	445, // SMB
	465, // SMTPS
	514, // syslog
	587, // SMTP submission
	631, // IPP
	993, // IMAPS
	995, // POP3S
	1433, // MS-SQL
	1521, // Oracle
	2049, // NFS
	3306, // MySQL
	3389, // RDP
	5432, // PostgreSQL
	5900, // VNC
	5984, // CouchDB
	6379, // Redis
	6667, // IRC
	9200, // Elasticsearch
	11211, // memcached
	27017, // MongoDB
]);

/** Hostname patterns that map to loopback / link-local without DNS. The
 *  broker rejects these even before resolution because resolvers vary
 *  (some return ::1, some 127.0.0.1, some refuse). Lower-cased input. */
const LOCAL_HOSTNAME_PATTERNS: readonly RegExp[] = [
	/^localhost$/,
	/\.localhost$/,
	/\.local$/,
	/^ip6-localhost$/,
	/^ip6-loopback$/,
];

/** Options for the SSRF check functions. Net-1b: `allowPrivate` flips
 *  the `LocalHostname` (pre-DNS) + `PrivateIp` (post-DNS) rejections
 *  into accepts so a caller holding `network.fetch.private` can reach
 *  RFC1918 / loopback / link-local addresses. The hard floor — non-HTTP
 *  scheme, malformed URL, blocked port, IDN decode, malformed IP — is
 *  unconditional; `.private` never relaxes it. */
export type SsrfCheckOptions = {
	readonly allowPrivate?: boolean;
};

/**
 * Validate a URL before DNS resolution. The caller MUST then resolve the
 * hostname and validate every resolved IP via `checkResolvedIp` before
 * connecting; this function alone is not sufficient to block SSRF.
 */
export function checkUrl(input: string, options: SsrfCheckOptions = {}): SsrfCheck {
	if (typeof input !== "string" || input.length === 0) {
		return {
			ok: false,
			reason: SsrfRejection.MalformedUrl,
			detail: "url must be a non-empty string",
		};
	}
	let url: URL;
	try {
		url = new URL(input);
	} catch (_error) {
		return { ok: false, reason: SsrfRejection.MalformedUrl, detail: `URL parse failed for ${input}` };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return {
			ok: false,
			reason: SsrfRejection.NonHttpScheme,
			detail: `scheme ${url.protocol} is not http/https`,
		};
	}
	if (url.hostname.length === 0) {
		return { ok: false, reason: SsrfRejection.EmptyHost, detail: "url has no hostname" };
	}
	// `URL.hostname` is already IDN-normalised by the WHATWG URL parser
	// (browser / Node behaviour matches). If the input contained
	// punycode-able unicode the hostname is in xn--… form here.
	const hostname = url.hostname.toLowerCase();
	for (const pattern of LOCAL_HOSTNAME_PATTERNS) {
		if (pattern.test(hostname)) {
			// Net-1b — `.private` caller opted into private-network
			// access. Falls through to port + IP-literal checks below.
			if (options.allowPrivate) break;
			return {
				ok: false,
				reason: SsrfRejection.LocalHostname,
				detail: `hostname ${hostname} resolves to loopback by convention`,
			};
		}
	}
	const port = url.port.length === 0 ? defaultPortFor(url.protocol) : Number(url.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return {
			ok: false,
			reason: SsrfRejection.MalformedUrl,
			detail: `invalid port ${url.port}`,
		};
	}
	if (BLOCKED_PORTS.has(port)) {
		return {
			ok: false,
			reason: SsrfRejection.BlockedPort,
			detail: `port ${port} is blocked (non-HTTP service)`,
		};
	}
	// If the hostname is already a literal IP, validate it now too — saves
	// the caller a resolve+recheck round-trip when the URL bypassed DNS.
	if (isIpLiteral(hostname)) {
		const ipCheck = checkResolvedIp(stripIpBrackets(hostname), options);
		if (!ipCheck.ok) return ipCheck;
	}
	return {
		ok: true,
		hostname,
		canonicalUrl: url.toString(),
		port,
	};
}

/**
 * Validate a single resolved IP address. The caller resolves the hostname
 * to one or more IPs (via `dns.lookup` with `{all: true}`) and runs each
 * through this function; the request proceeds only when EVERY resolved IP
 * passes. On every redirect, the new Location's hostname is re-resolved
 * and the same check runs again.
 *
 * IPv4 literal accepted in dotted-quad form ("10.0.0.1") plus the
 * IPv4-mapped IPv6 form ("::ffff:10.0.0.1"). IPv6 accepted with or
 * without surrounding `[]`; the caller-side bracket stripping is the
 * common Node `URL.hostname` shape.
 */
export function checkResolvedIp(ip: string, options: SsrfCheckOptions = {}): SsrfCheck {
	if (typeof ip !== "string" || ip.length === 0) {
		return {
			ok: false,
			reason: SsrfRejection.MalformedIp,
			detail: "ip must be a non-empty string",
		};
	}
	const trimmed = stripIpBrackets(ip).toLowerCase();
	const v4 = parseIpv4(trimmed);
	if (v4 !== null) {
		const rejection = classifyIpv4(v4);
		if (rejection) {
			// Net-1b — `.private` caller opts into private/loopback/etc.
			// IPv4 ranges. The malformed-IP path stays a hard floor (it
			// only fires from `parseIpv4` returning null, never here).
			if (options.allowPrivate) {
				return { ok: true, hostname: trimmed, canonicalUrl: "", port: 0 };
			}
			return {
				ok: false,
				reason: SsrfRejection.PrivateIp,
				detail: `${ip}: ${rejection}`,
			};
		}
		return { ok: true, hostname: trimmed, canonicalUrl: "", port: 0 };
	}
	const v6 = parseIpv6(trimmed);
	if (v6 !== null) {
		const rejection = classifyIpv6(v6);
		if (rejection) {
			if (options.allowPrivate) {
				return { ok: true, hostname: trimmed, canonicalUrl: "", port: 0 };
			}
			return {
				ok: false,
				reason: SsrfRejection.PrivateIp,
				detail: `${ip}: ${rejection}`,
			};
		}
		return { ok: true, hostname: trimmed, canonicalUrl: "", port: 0 };
	}
	return {
		ok: false,
		reason: SsrfRejection.MalformedIp,
		detail: `could not parse ${ip} as IPv4 or IPv6`,
	};
}

function defaultPortFor(protocol: string): number {
	if (protocol === "https:") return 443;
	if (protocol === "http:") return 80;
	// Unreachable — checkUrl rejects non-http schemes earlier; defensive.
	return 0;
}

function isIpLiteral(hostname: string): boolean {
	return parseIpv4(hostname) !== null || parseIpv6(stripIpBrackets(hostname)) !== null;
}

function stripIpBrackets(ip: string): string {
	if (ip.startsWith("[") && ip.endsWith("]")) return ip.slice(1, -1);
	return ip;
}

/** Parse a dotted-quad IPv4 literal into a 4-byte array. Returns null on
 *  any deviation from canonical form (leading zeros are OK, but octal
 *  interpretation is NOT — every octet is decimal 0-255). */
function parseIpv4(input: string): readonly number[] | null {
	const parts = input.split(".");
	if (parts.length !== 4) return null;
	const out: number[] = [];
	for (const part of parts) {
		if (part.length === 0 || part.length > 3) return null;
		if (!/^[0-9]+$/.test(part)) return null;
		const n = Number(part);
		if (!Number.isInteger(n) || n < 0 || n > 255) return null;
		out.push(n);
	}
	return out;
}

/** Parse an IPv6 literal (without brackets) into 8 16-bit groups. Supports
 *  `::` compression and IPv4-mapped suffix (`::ffff:1.2.3.4`). Returns
 *  null on any deviation. */
function parseIpv6(input: string): readonly number[] | null {
	// Split into "before-::" and "after-::" halves. At most one `::`.
	const doubleColons = (input.match(/::/g) ?? []).length;
	if (doubleColons > 1) return null;
	let head: string;
	let tail: string;
	if (doubleColons === 1) {
		const [h, t] = input.split("::") as [string, string];
		head = h;
		tail = t;
	} else {
		head = input;
		tail = "";
	}
	const headGroups = head.length > 0 ? head.split(":") : [];
	const tailGroups = tail.length > 0 ? tail.split(":") : [];
	// If the LAST tail group is an IPv4 dotted-quad, expand it to 2 IPv6 groups.
	const v4Suffix = tailGroups[tailGroups.length - 1];
	let groupsFromV4: number[] = [];
	if (v4Suffix?.includes(".")) {
		const v4 = parseIpv4(v4Suffix);
		if (v4 === null) return null;
		const [a, b, c, d] = v4 as [number, number, number, number];
		groupsFromV4 = [(a << 8) | b, (c << 8) | d];
		tailGroups.pop();
	}
	const explicit = headGroups.length + tailGroups.length + groupsFromV4.length;
	if (explicit > 8) return null;
	const fillCount = 8 - explicit;
	if (doubleColons === 0 && fillCount !== 0) return null;
	const parseGroup = (g: string): number | null => {
		if (g.length === 0 || g.length > 4) return null;
		if (!/^[0-9a-f]+$/.test(g)) return null;
		return Number.parseInt(g, 16);
	};
	const groups: number[] = [];
	for (const g of headGroups) {
		const n = parseGroup(g);
		if (n === null) return null;
		groups.push(n);
	}
	for (let i = 0; i < fillCount; i++) groups.push(0);
	for (const g of tailGroups) {
		const n = parseGroup(g);
		if (n === null) return null;
		groups.push(n);
	}
	for (const n of groupsFromV4) groups.push(n);
	if (groups.length !== 8) return null;
	return groups;
}

/** Returns null when the IPv4 is public-routable; a string reason otherwise. */
function classifyIpv4(octets: readonly number[]): string | null {
	const [a, b, _c, _d] = octets as [number, number, number, number];
	if (a === 0) return "0.0.0.0/8 (this network)";
	if (a === 10) return "10.0.0.0/8 (private)";
	if (a === 100 && b >= 64 && b <= 127) return "100.64.0.0/10 (CGNAT)";
	if (a === 127) return "127.0.0.0/8 (loopback)";
	if (a === 169 && b === 254) return "169.254.0.0/16 (link-local / cloud metadata)";
	if (a === 172 && b >= 16 && b <= 31) return "172.16.0.0/12 (private)";
	if (a === 192 && b === 0 && _c === 0) return "192.0.0.0/24 (IETF protocol assignments)";
	if (a === 192 && b === 0 && _c === 2) return "192.0.2.0/24 (TEST-NET-1 documentation)";
	if (a === 192 && b === 168) return "192.168.0.0/16 (private)";
	if (a === 198 && (b === 18 || b === 19)) return "198.18.0.0/15 (benchmarking)";
	if (a === 198 && b === 51 && _c === 100) return "198.51.100.0/24 (TEST-NET-2 documentation)";
	if (a === 203 && b === 0 && _c === 113) return "203.0.113.0/24 (TEST-NET-3 documentation)";
	if (a >= 224 && a <= 239) return "224.0.0.0/4 (multicast)";
	if (a >= 240) return "240.0.0.0/4 (reserved)";
	return null;
}

/** Returns null when the IPv6 is public-routable; a string reason otherwise. */
function classifyIpv6(groups: readonly number[]): string | null {
	// ::/128 (unspecified)
	if (groups.every((g) => g === 0)) return "::/128 (unspecified)";
	// ::1/128 (loopback)
	if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return "::1/128 (loopback)";
	// ::ffff:0:0/96 (IPv4-mapped IPv6) — defer to IPv4 classifier.
	if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
		const v4High = groups[6] ?? 0;
		const v4Low = groups[7] ?? 0;
		const v4 = [(v4High >> 8) & 0xff, v4High & 0xff, (v4Low >> 8) & 0xff, v4Low & 0xff];
		const reason = classifyIpv4(v4);
		return reason ? `IPv4-mapped → ${reason}` : null;
	}
	// 64:ff9b::/96 (IPv4-IPv6 translation per RFC 6052)
	if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
		return "64:ff9b::/96 (NAT64)";
	}
	// 100::/64 (discard prefix)
	if (groups[0] === 0x100 && groups.slice(1, 4).every((g) => g === 0)) {
		return "100::/64 (discard)";
	}
	// fc00::/7 (unique local — fc00-fdff)
	const g0 = groups[0] ?? 0;
	if ((g0 & 0xfe00) === 0xfc00) return "fc00::/7 (unique local)";
	// fe80::/10 (link-local — fe80-febf)
	if ((g0 & 0xffc0) === 0xfe80) return "fe80::/10 (link-local)";
	// ff00::/8 (multicast — ff00-ffff)
	if ((g0 & 0xff00) === 0xff00) return "ff00::/8 (multicast)";
	// 2001:db8::/32 (documentation per RFC 3849)
	if (g0 === 0x2001 && groups[1] === 0x0db8) return "2001:db8::/32 (documentation)";
	return null;
}
