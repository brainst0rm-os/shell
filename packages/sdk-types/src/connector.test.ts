import { describe, expect, it } from "vitest";
import {
	AUTH_STATES,
	AuthState,
	CONFLICT_POLICIES,
	CONNECTOR_ACCOUNT_TYPE_URL,
	CONNECTOR_TYPE_URL,
	ConflictPolicy,
	type ConnectorAccountDef,
	type ConnectorDef,
	ConnectorIssueCode,
	EgressRefusalReason,
	MAX_SYNC_MAPPINGS_HARD,
	MAX_SYNC_MAPPINGS_SOFT,
	SYNC_DIRECTIONS,
	SYNC_MAPPING_TYPE_URL,
	SYNC_RUN_STATUSES,
	SYNC_RUN_TYPE_URL,
	SyncDirection,
	type SyncMappingDef,
	type SyncRunDef,
	SyncRunStatus,
	capabilityImplies,
	connectorEgressCapabilities,
	connectorRequiredCapabilities,
	isAuthState,
	isConflictPolicy,
	isEgressAllowed,
	isSyncDirection,
	isSyncRunStatus,
	isWildcardAll,
	parseOriginPattern,
	validateConnector,
	validateConnectorAccount,
	validateConnectorRequest,
	validateSyncMapping,
	validateSyncRun,
} from "./connector";

describe("connector contracts — type urls + enums", () => {
	it("freezes the four canonical type urls", () => {
		expect(CONNECTOR_TYPE_URL).toBe("brainstorm/Connector/v1");
		expect(CONNECTOR_ACCOUNT_TYPE_URL).toBe("brainstorm/ConnectorAccount/v1");
		expect(SYNC_MAPPING_TYPE_URL).toBe("brainstorm/SyncMapping/v1");
		expect(SYNC_RUN_TYPE_URL).toBe("brainstorm/SyncRun/v1");
	});

	it("enum guards accept members and reject non-members", () => {
		expect(SYNC_DIRECTIONS).toEqual(["pull", "push", "two-way"]);
		expect(CONFLICT_POLICIES).toContain(ConflictPolicy.ExternalWins);
		expect(AUTH_STATES).toContain(AuthState.Active);
		expect(SYNC_RUN_STATUSES).toContain(SyncRunStatus.Succeeded);
		expect(isSyncDirection(SyncDirection.Pull)).toBe(true);
		expect(isSyncDirection("sideways")).toBe(false);
		expect(isConflictPolicy(ConflictPolicy.VaultWins)).toBe(true);
		expect(isConflictPolicy(null)).toBe(false);
		expect(isAuthState(AuthState.Revoked)).toBe(true);
		expect(isAuthState("zombie")).toBe(false);
		expect(isSyncRunStatus(SyncRunStatus.Failed)).toBe(true);
		expect(isSyncRunStatus(2)).toBe(false);
	});

	it("exposes the doc-56 volume budgets", () => {
		expect(MAX_SYNC_MAPPINGS_SOFT).toBe(200);
		expect(MAX_SYNC_MAPPINGS_HARD).toBe(2000);
	});
});

describe("egress keystone — parseOriginPattern", () => {
	it("defaults a bare host to https, no port", () => {
		expect(parseOriginPattern("api.github.com")).toEqual({
			scheme: "https",
			host: "api.github.com",
			port: null,
		});
	});

	it("parses scheme, wildcard host, and explicit port; strips path", () => {
		expect(parseOriginPattern("https://*.slack.com")).toEqual({
			scheme: "https",
			host: "*.slack.com",
			port: null,
		});
		expect(parseOriginPattern("https://api.github.com:8443/v3")).toEqual({
			scheme: "https",
			host: "api.github.com",
			port: 8443,
		});
	});

	it("rejects malformed input", () => {
		expect(parseOriginPattern("")).toBeNull();
		expect(parseOriginPattern("https://api.github.com:notaport")).toBeNull();
		expect(parseOriginPattern("https://")).toBeNull();
	});
});

describe("egress keystone — isWildcardAll", () => {
	it("flags catch-all forms", () => {
		expect(isWildcardAll("*")).toBe(true);
		expect(isWildcardAll("*://*")).toBe(true);
		expect(isWildcardAll("https://*")).toBe(true);
	});

	it("does not flag a single-subdomain wildcard or an exact host", () => {
		expect(isWildcardAll("*.slack.com")).toBe(false);
		expect(isWildcardAll("api.github.com")).toBe(false);
	});
});

describe("egress keystone — isEgressAllowed", () => {
	const origins = ["https://api.github.com", "https://*.slack.com"];

	it("allows an exact-host https URL", () => {
		expect(isEgressAllowed(origins, "https://api.github.com/repos/x/y/issues")).toBe(true);
	});

	it("allows a subdomain under a *.suffix but not the apex", () => {
		expect(isEgressAllowed(origins, "https://files.slack.com/x")).toBe(true);
		expect(isEgressAllowed(origins, "https://slack.com/x")).toBe(false);
	});

	it("fails closed on scheme, host, port mismatch and unparseable input", () => {
		expect(isEgressAllowed(origins, "http://api.github.com/x")).toBe(false); // scheme
		expect(isEgressAllowed(origins, "https://evil.example.com/x")).toBe(false); // host
		expect(isEgressAllowed(origins, "https://api.github.com:8443/x")).toBe(false); // port
		expect(isEgressAllowed(origins, "not a url")).toBe(false);
	});

	it("never honors a wildcard-all origin", () => {
		expect(isEgressAllowed(["*"], "https://anything.example.com")).toBe(false);
	});
});

describe("egress keystone — validateConnectorRequest", () => {
	const origins = ["https://api.github.com"];

	it("allows an in-scope URL", () => {
		expect(validateConnectorRequest(origins, "https://api.github.com/x")).toEqual({
			allowed: true,
		});
	});

	it("returns a typed reason on each refusal", () => {
		expect(validateConnectorRequest(origins, "::bad::")).toEqual({
			allowed: false,
			reason: EgressRefusalReason.Unparseable,
		});
		expect(validateConnectorRequest(["*"], "https://api.github.com/x")).toEqual({
			allowed: false,
			reason: EgressRefusalReason.WildcardOrigin,
		});
		expect(validateConnectorRequest(origins, "https://evil.example.com/x")).toEqual({
			allowed: false,
			reason: EgressRefusalReason.OutOfScope,
		});
	});
});

describe("capability keystone", () => {
	it("derives network.connect:<origin> per frozen origin, never *", () => {
		expect(connectorEgressCapabilities(["https://api.github.com", "*.slack.com"])).toEqual([
			"network.connect:https://*.slack.com",
			"network.connect:https://api.github.com",
		]);
		expect(connectorEgressCapabilities(["*"])).toEqual([]);
	});

	it("aggregates egress + entities.write caps, sorted & deduped", () => {
		expect(
			connectorRequiredCapabilities({
				egressOrigins: ["https://api.github.com"],
				entityTypes: ["brainstorm/Task/v1", "brainstorm/Task/v1"],
			}),
		).toEqual(["entities.write:brainstorm/Task/v1", "network.connect:https://api.github.com"]);
	});

	it("mirrors the ledger scope rule", () => {
		expect(capabilityImplies("network.connect:*", "network.connect:https://api.github.com")).toBe(
			true,
		);
		expect(
			capabilityImplies(
				"network.connect:https://api.github.com",
				"network.connect:https://api.github.com",
			),
		).toBe(true);
		expect(
			capabilityImplies(
				"network.connect:https://api.github.com",
				"network.connect:https://evil.example.com",
			),
		).toBe(false);
	});
});

describe("validators", () => {
	const connector: ConnectorDef = {
		connectorAppId: "io.brainstorm.github-issues",
		displayName: "GitHub Issues",
		enabled: true,
		egressOrigins: ["https://api.github.com"],
		apiBaseUrl: "https://api.github.com",
		defaultSyncInterval: 900,
	};

	it("passes a well-formed connector and flags wildcard / out-of-scope base url", () => {
		expect(validateConnector(connector)).toEqual([]);
		const wild = validateConnector({ ...connector, egressOrigins: ["*"] });
		expect(wild.map((i) => i.code)).toContain(ConnectorIssueCode.WildcardEgressOrigin);
		const offscope = validateConnector({
			...connector,
			apiBaseUrl: "https://evil.example.com",
		});
		expect(offscope.map((i) => i.code)).toContain(ConnectorIssueCode.ApiBaseUrlOutOfScope);
		const noInterval = validateConnector({ ...connector, defaultSyncInterval: 0 });
		expect(noInterval.map((i) => i.code)).toContain(ConnectorIssueCode.InvalidSyncInterval);
	});

	it("rejects a secret-shaped field on the account entity (custody invariant)", () => {
		const account = {
			connectorRef: "connector-1",
			externalAccountLabel: "octocat",
			scopesGranted: ["repo"],
			authState: AuthState.Active,
			accessToken: "ghp_leaked",
		} as unknown as ConnectorAccountDef;
		expect(validateConnectorAccount(account).map((i) => i.code)).toContain(
			ConnectorIssueCode.EmbeddedSecret,
		);
	});

	it("passes a clean account and flags an unknown auth state", () => {
		const account: ConnectorAccountDef = {
			connectorRef: "connector-1",
			externalAccountLabel: "octocat",
			scopesGranted: ["repo"],
			authState: AuthState.Active,
		};
		expect(validateConnectorAccount(account)).toEqual([]);
		expect(
			validateConnectorAccount({
				...account,
				authState: "weird" as AuthState,
			}).map((i) => i.code),
		).toContain(ConnectorIssueCode.InvalidAuthState);
	});

	it("validates a sync mapping and a sync run", () => {
		const mapping: SyncMappingDef = {
			accountRef: "account-1",
			externalKind: "github:issue",
			entityType: "brainstorm/Task/v1",
			fieldMap: { title: "title" },
			direction: SyncDirection.Pull,
			conflictPolicy: ConflictPolicy.ExternalWins,
		};
		expect(validateSyncMapping(mapping)).toEqual([]);
		expect(
			validateSyncMapping({ ...mapping, direction: "x" as SyncDirection }).map((i) => i.code),
		).toContain(ConnectorIssueCode.InvalidDirection);

		const run: SyncRunDef = {
			mappingRef: "mapping-1",
			startedAt: "2026-06-06T00:00:00Z",
			status: SyncRunStatus.Succeeded,
			pulled: 3,
			pushed: 0,
			conflicts: 0,
		};
		expect(validateSyncRun(run)).toEqual([]);
		expect(validateSyncRun({ ...run, status: "x" as SyncRunStatus }).map((i) => i.code)).toContain(
			ConnectorIssueCode.InvalidRunStatus,
		);
	});
});
