import { RecurrenceKind } from "@brainstorm/sdk-types";
import { beforeEach, describe, expect, it } from "vitest";
import { type PersistedFire, SchedulerService, type SchedulerStore } from "./scheduler-service";

const T0 = Date.UTC(2026, 5, 6, 9, 0, 0);
const DAY = 86_400_000;

class FakeStore implements SchedulerStore {
	rows = new Map<string, PersistedFire>();
	loadAll(): PersistedFire[] {
		return [...this.rows.values()];
	}
	save(fire: PersistedFire): void {
		this.rows.set(fire.triggerId, fire);
	}
	remove(triggerId: string): void {
		this.rows.delete(triggerId);
	}
}

describe("SchedulerService", () => {
	let store: FakeStore;
	let svc: SchedulerService;

	beforeEach(() => {
		store = new FakeStore();
		svc = new SchedulerService(store);
	});

	it("persists a trigger on register and computes its first fire", async () => {
		await svc.register("t1", ["wf1"], { oneShotAt: T0 + DAY }, T0);
		expect(store.rows.get("t1")?.nextFireAt).toBe(T0 + DAY);
		expect(svc.nextWakeAt()).toBe(T0 + DAY);
	});

	it("fires due triggers, one request per workflow, in order", async () => {
		await svc.register("t1", ["wfA", "wfB"], { oneShotAt: T0 - 5 }, T0 - DAY);
		await svc.register("t2", ["wfC"], { oneShotAt: T0 - 10 }, T0 - DAY);
		const requests = await svc.tick(T0);
		expect(requests).toEqual([
			{ triggerId: "t2", workflowId: "wfC", firedAt: T0 },
			{ triggerId: "t1", workflowId: "wfA", firedAt: T0 },
			{ triggerId: "t1", workflowId: "wfB", firedAt: T0 },
		]);
	});

	it("does not fire a future trigger", async () => {
		await svc.register("t1", ["wf"], { oneShotAt: T0 + DAY }, T0);
		expect(await svc.tick(T0)).toEqual([]);
	});

	it("re-arms a recurring trigger and persists the new fire", async () => {
		await svc.register("t1", ["wf"], { recurrence: { kind: RecurrenceKind.Daily, every: 1 } }, T0);
		expect(store.rows.get("t1")?.nextFireAt).toBe(T0 + DAY);
		// fire it the next day
		await svc.tick(T0 + DAY);
		expect(store.rows.get("t1")?.nextFireAt).toBe(T0 + 2 * DAY);
	});

	it("sends a spent one-shot dormant after firing (fires exactly once)", async () => {
		await svc.register("t1", ["wf"], { oneShotAt: T0 }, T0 - DAY);
		expect(await svc.tick(T0)).toHaveLength(1);
		expect(store.rows.get("t1")?.nextFireAt).toBeNull();
		expect(await svc.tick(T0 + DAY)).toEqual([]);
		expect(svc.nextWakeAt()).toBeNull();
	});

	it("unregister removes the trigger from state and store", async () => {
		await svc.register("t1", ["wf"], { oneShotAt: T0 + DAY }, T0);
		await svc.unregister("t1");
		expect(store.rows.has("t1")).toBe(false);
		expect(svc.registeredTriggerIds()).toEqual([]);
	});

	it("survives a restart by hydrating the persisted schedule", async () => {
		await svc.register("t1", ["wf"], { recurrence: { kind: RecurrenceKind.Daily, every: 1 } }, T0);
		// new service instance over the same store = a process restart
		const revived = new SchedulerService(store);
		await revived.hydrate();
		expect(revived.registeredTriggerIds()).toEqual(["t1"]);
		expect(revived.nextWakeAt()).toBe(T0 + DAY);
		// and it still fires correctly post-restart
		expect(await revived.tick(T0 + DAY)).toHaveLength(1);
	});

	it("a late wake-up jumps to the next future slot, not a backlog replay", async () => {
		await svc.register("t1", ["wf"], { recurrence: { kind: RecurrenceKind.Daily, every: 1 } }, T0);
		// scheduler was asleep for 5 days; one tick fires once and re-arms ahead
		const requests = await svc.tick(T0 + 5 * DAY);
		expect(requests).toHaveLength(1);
		expect(store.rows.get("t1")?.nextFireAt).toBe(T0 + 6 * DAY);
	});
});
