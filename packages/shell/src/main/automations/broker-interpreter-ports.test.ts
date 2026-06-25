import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "../../ipc/envelope";
import {
	type ServiceHandlerGetter,
	createBrokerInterpreterPorts,
	makeCapScopedHttpPort,
} from "./broker-interpreter-ports";

/** A fake broker: record envelopes per service, return canned results. */
function fakeBroker(results: Record<string, unknown> = {}) {
	const calls: Envelope[] = [];
	const getServiceHandler: ServiceHandlerGetter = (name) => {
		if (name === "missing") return undefined;
		return (env: Envelope) => {
			calls.push(env);
			return results[`${env.service}.${env.method}`] ?? null;
		};
	};
	return { calls, getServiceHandler };
}

const base = { appId: "io.brainstorm.automations", caps: ["entities.write:Note/v1"] };

describe("createBrokerInterpreterPorts", () => {
	it("stamps the automations identity + workflow caps on every envelope", async () => {
		const broker = fakeBroker({ "ui.notify": null });
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
		});
		await ports.notify({ title: "Hi" });
		expect(broker.calls[0]).toMatchObject({
			app: "io.brainstorm.automations",
			caps: ["entities.write:Note/v1"],
			service: "ui",
			method: "notify",
			args: [{ title: "Hi" }],
		});
	});

	it("entities.create maps to the create envelope and normalises the result", async () => {
		const broker = fakeBroker({
			"entities.create": { id: "e1", type: "Note/v1", properties: { title: "T" }, extra: "ignored" },
		});
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
		});
		const rec = await ports.entities.create("Note/v1", { title: "T" });
		expect(broker.calls[0]).toMatchObject({
			service: "entities",
			method: "create",
			args: [{ type: "Note/v1", properties: { title: "T" } }],
		});
		expect(rec).toEqual({ id: "e1", type: "Note/v1", properties: { title: "T" } });
	});

	it("entities.update sends { id, patch }", async () => {
		const broker = fakeBroker({ "entities.update": { id: "e1", type: "Note/v1", properties: {} } });
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
		});
		await ports.entities.update("e1", { done: true });
		expect(broker.calls[0]?.args).toEqual([{ id: "e1", patch: { done: true } }]);
	});

	it("entities.get returns null for a null row", async () => {
		const broker = fakeBroker({ "entities.get": null });
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
		});
		expect(await ports.entities.get("nope")).toBeNull();
	});

	it("exporter maps to export.serializeEntities and returns the content string (IE-8)", async () => {
		const broker = fakeBroker({ "export.serializeEntities": "# Note\n" });
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
		});
		const content = await ports.exporter?.({ format: "markdown", ids: ["e1", "e2"] });
		expect(broker.calls[0]).toMatchObject({
			service: "export",
			method: "serializeEntities",
			args: [{ ids: ["e1", "e2"], format: "markdown" }],
			caps: ["entities.write:Note/v1"],
		});
		expect(content).toBe("# Note\n");
	});

	it("ai maps to ai.generate, carries the workflow caps, and returns content + provenance (11b.7)", async () => {
		const broker = fakeBroker({
			"ai.generate": { content: "a reply", provider: "ollama", model: "llama3" },
		});
		const ports = createBrokerInterpreterPorts({
			...base,
			caps: ["ai.use", "ai.provider:ollama"],
			getServiceHandler: broker.getServiceHandler,
		});
		const result = await ports.ai?.({
			messages: [{ role: "user", content: "hi" } as never],
			provider: "ollama",
			model: "llama3",
		});
		expect(broker.calls[0]).toMatchObject({
			service: "ai",
			method: "generate",
			args: [{ messages: [{ role: "user", content: "hi" }], provider: "ollama", model: "llama3" }],
			caps: ["ai.use", "ai.provider:ollama"],
		});
		expect(result?.content).toBe("a reply");
		expect(result?.provenance).toMatchObject({ provider: "ollama", model: "llama3" });
	});

	it("entities.query forces the declared type — an untrusted filter can't override it", async () => {
		const broker = fakeBroker({ "entities.query": [] });
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
		});
		// `filter` is the untrusted prior-step output; a malicious `type` in it
		// must NOT widen the query past the step's declared scope (11b.6 gate 2).
		await ports.entities.query("Note/v1", { type: "Secret/v1", status: "open" });
		expect(broker.calls[0]?.args).toEqual([{ query: { status: "open", type: "Note/v1" } }]);
	});

	it("entities.query folds the type into the query and maps rows", async () => {
		const broker = fakeBroker({
			"entities.query": [{ id: "a", type: "Note/v1", properties: {} }],
		});
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
		});
		const rows = await ports.entities.query("Note/v1", { status: "open" });
		expect(broker.calls[0]?.args).toEqual([{ query: { type: "Note/v1", status: "open" } }]);
		expect(rows).toEqual([{ id: "a", type: "Note/v1", properties: {} }]);
	});

	it("intents.dispatch folds entityType + args into the payload", async () => {
		const broker = fakeBroker({ "intents.dispatch": { handled: true } });
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
		});
		const out = await ports.intents.dispatch("open", "Note/v1", { entityId: "e1" });
		expect(broker.calls[0]).toMatchObject({
			service: "intents",
			method: "dispatch",
			args: [{ verb: "open", payload: { entityId: "e1", entityType: "Note/v1" } }],
		});
		expect(out).toEqual({ handled: true });
	});

	it("loadWorkflowSteps returns the steps + the callee's own frozen caps", async () => {
		const steps = [{ id: "n", kind: "notify", title: "x" }];
		const broker = fakeBroker({
			"entities.get": {
				id: "wf2",
				type: "Workflow/v1",
				properties: { enabled: true, steps, capabilities: ["notifications.post"] },
			},
		});
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
		});
		expect(await ports.loadWorkflowSteps("wf2")).toEqual({
			steps,
			capabilities: ["notifications.post"],
		});
	});

	it("loadWorkflowSteps defaults caps to [] when the callee declares none", async () => {
		const steps = [{ id: "n", kind: "notify", title: "x" }];
		const broker = fakeBroker({
			"entities.get": { id: "wf2", type: "Workflow/v1", properties: { enabled: true, steps } },
		});
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
		});
		expect(await ports.loadWorkflowSteps("wf2")).toEqual({ steps, capabilities: [] });
	});

	it("exposes the running caps it was built under", () => {
		const broker = fakeBroker({});
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
		});
		expect(ports.capabilities).toEqual(base.caps);
	});

	it("loadWorkflowSteps returns null for a disabled or missing workflow", async () => {
		const disabled = fakeBroker({
			"entities.get": { id: "wf2", type: "Workflow/v1", properties: { enabled: false, steps: [] } },
		});
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: disabled.getServiceHandler,
		});
		expect(await ports.loadWorkflowSteps("wf2")).toBeNull();

		const missing = fakeBroker({ "entities.get": null });
		const ports2 = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: missing.getServiceHandler,
		});
		expect(await ports2.loadWorkflowSteps("gone")).toBeNull();
	});

	it("throws a clear error when a service is unavailable", async () => {
		const getServiceHandler: ServiceHandlerGetter = () => undefined;
		const ports = createBrokerInterpreterPorts({ ...base, getServiceHandler });
		await expect(ports.notify({ title: "x" })).rejects.toThrow("service-unavailable:ui");
	});

	it("uses the injected sleep", async () => {
		const sleep = vi.fn(async () => {});
		const broker = fakeBroker();
		const ports = createBrokerInterpreterPorts({
			...base,
			getServiceHandler: broker.getServiceHandler,
			sleep,
		});
		await ports.sleep(123);
		expect(sleep).toHaveBeenCalledWith(123);
	});
});

describe("makeCapScopedHttpPort (11b.8)", () => {
	const okEgress = vi.fn(async () => ({
		status: 200,
		body: new TextEncoder().encode('{"ok":true}'),
	}));

	it("egresses when the workflow's frozen caps cover the origin", async () => {
		okEgress.mockClear();
		const port = makeCapScopedHttpPort(okEgress, ["network.egress:https://api.example.com"]);
		const res = await port({ method: "GET", url: "https://api.example.com/v1/things" });
		expect(res).toEqual({ status: 200, bodyText: '{"ok":true}' });
		expect(okEgress).toHaveBeenCalledTimes(1);
	});

	it("a wildcard-scoped grant covers any origin", async () => {
		okEgress.mockClear();
		const port = makeCapScopedHttpPort(okEgress, ["network.egress:*"]);
		await port({ method: "GET", url: "https://anywhere.example/x" });
		expect(okEgress).toHaveBeenCalledTimes(1);
	});

	it("fail-closed: refuses an origin outside the frozen caps, no egress", async () => {
		okEgress.mockClear();
		const port = makeCapScopedHttpPort(okEgress, ["network.egress:https://api.example.com"]);
		await expect(port({ method: "GET", url: "https://evil.example/x" })).rejects.toThrow(
			"http-egress-denied:https://evil.example",
		);
		// An unrelated capability never satisfies the egress check.
		const noCaps = makeCapScopedHttpPort(okEgress, ["entities.read:*"]);
		await expect(noCaps({ method: "GET", url: "https://api.example.com/x" })).rejects.toThrow(
			"http-egress-denied",
		);
		expect(okEgress).not.toHaveBeenCalled();
	});

	it("stamps a JSON content-type only when a body rides along", async () => {
		const seen: Array<Record<string, string> | undefined> = [];
		const egress = async (req: { headers?: Record<string, string> }) => {
			seen.push(req.headers);
			return { status: 200, body: new Uint8Array() };
		};
		const port = makeCapScopedHttpPort(egress, ["network.egress:*"]);
		await port({ method: "GET", url: "https://a.example/x" });
		await port({ method: "POST", url: "https://a.example/x", body: new Uint8Array([1]) });
		expect(seen[0]).toBeUndefined();
		expect(seen[1]).toEqual({ "Content-Type": "application/json" });
	});
});
