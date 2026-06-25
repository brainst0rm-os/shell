/**
 * Coverage for the React adapter to the block-renderer registry:
 * provider wiring, async resolution mid-render, fast-id-switch race
 * safety, missing-provider fall-through, cache-shared-across-mounts.
 */

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BlockRendererFallbackReason,
	BlockRendererKind,
	BlockRendererRegistryProvider,
	type BpResolver,
	SHELL_ENTITY_CARD_BLOCK_ID,
	createBlockRendererRegistry,
	useBlockRenderer,
} from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

function Probe({ blockId }: { blockId: string }) {
	const info = useBlockRenderer(blockId);
	if (info === null) return <span data-testid="probe">loading</span>;
	if (info.kind === BlockRendererKind.Fallback) {
		return <span data-testid="probe">{`fallback:${info.reason}`}</span>;
	}
	if (info.kind === BlockRendererKind.CustomNode) {
		return <span data-testid="probe">{`custom:${info.blockId}`}</span>;
	}
	return <span data-testid="probe">{`bp:${info.appId}/${info.name}`}</span>;
}

function probeText(): string {
	const node = container.querySelector('[data-testid="probe"]');
	return node?.textContent ?? "";
}

async function flush(ms = 0): Promise<void> {
	await act(async () => {
		await new Promise((r) => setTimeout(r, ms));
	});
}

describe("useBlockRenderer", () => {
	it("resolves to fallback when no provider is mounted", async () => {
		await act(async () => {
			root.render(<Probe blockId="anything/at-all" />);
		});
		await flush();
		expect(probeText()).toBe(`fallback:${BlockRendererFallbackReason.NoProvider}`);
	});

	it("renders the shell entity-card custom-node when pre-registered", async () => {
		const registry = createBlockRendererRegistry({
			builtInCustomNodes: [SHELL_ENTITY_CARD_BLOCK_ID],
		});
		await act(async () => {
			root.render(
				<BlockRendererRegistryProvider registry={registry}>
					<Probe blockId={SHELL_ENTITY_CARD_BLOCK_ID} />
				</BlockRendererRegistryProvider>,
			);
		});
		await flush();
		expect(probeText()).toBe(`custom:${SHELL_ENTITY_CARD_BLOCK_ID}`);
	});

	it("resolves to BlockProtocol when the resolver answers", async () => {
		const resolver: BpResolver = async () => ({ appId: "io.brainstorm.tasks", name: "list" });
		const registry = createBlockRendererRegistry({ bpResolver: resolver });
		await act(async () => {
			root.render(
				<BlockRendererRegistryProvider registry={registry}>
					<Probe blockId="io.brainstorm.tasks/list" />
				</BlockRendererRegistryProvider>,
			);
		});
		await flush();
		expect(probeText()).toBe("bp:io.brainstorm.tasks/list");
	});

	it("does not race a stale resolve into setInfo when blockId changes mid-flight", async () => {
		// The probe mounts with `slow/one`, immediately switches to
		// `fast/two`, and then the slow resolve is allowed to land. The
		// live-id guard must reject the stale write so the visible text
		// stays `fast/two`.
		let releaseSlow: (v: { appId: string; name: string }) => void = () => {};
		const slowPromise = new Promise<{ appId: string; name: string }>((res) => {
			releaseSlow = res;
		});
		const resolver: BpResolver = (blockId) => {
			if (blockId === "slow/one") return slowPromise;
			if (blockId === "fast/two") return Promise.resolve({ appId: "fast", name: "two" });
			return Promise.resolve(null);
		};
		const registry = createBlockRendererRegistry({ bpResolver: resolver });

		// Step 1: mount with the slow id. Probe shows "loading".
		await act(async () => {
			root.render(
				<BlockRendererRegistryProvider registry={registry}>
					<Probe blockId="slow/one" />
				</BlockRendererRegistryProvider>,
			);
		});
		expect(probeText()).toBe("loading");

		// Step 2: re-render with the fast id BEFORE the slow promise
		// settles. The fast resolve lands inside this act block.
		await act(async () => {
			root.render(
				<BlockRendererRegistryProvider registry={registry}>
					<Probe blockId="fast/two" />
				</BlockRendererRegistryProvider>,
			);
		});
		expect(probeText()).toBe("bp:fast/two");

		// Step 3: NOW release the slow resolve. The live-id guard must
		// reject it; the probe stays on `fast/two`.
		await act(async () => {
			releaseSlow({ appId: "slow", name: "one" });
			await Promise.resolve(); // let the then-handler micro-tick run
		});
		expect(probeText()).toBe("bp:fast/two");
	});

	it("calls the resolver exactly once for the same blockId across two mounted probes", async () => {
		const resolver = vi.fn<BpResolver>().mockResolvedValue({
			appId: "io.brainstorm.tasks",
			name: "list",
		});
		const registry = createBlockRendererRegistry({ bpResolver: resolver });
		await act(async () => {
			root.render(
				<BlockRendererRegistryProvider registry={registry}>
					<Probe blockId="io.brainstorm.tasks/list" />
					<Probe blockId="io.brainstorm.tasks/list" />
				</BlockRendererRegistryProvider>,
			);
		});
		await flush();
		const probes = container.querySelectorAll('[data-testid="probe"]');
		expect(probes).toHaveLength(2);
		for (const p of probes) expect(p.textContent).toBe("bp:io.brainstorm.tasks/list");
		expect(resolver).toHaveBeenCalledTimes(1);
	});

	it("resolves to Fallback{Invalid} for malformed block ids when a provider is mounted", async () => {
		const resolver = vi.fn<BpResolver>();
		const registry = createBlockRendererRegistry({ bpResolver: resolver });
		await act(async () => {
			root.render(
				<BlockRendererRegistryProvider registry={registry}>
					<Probe blockId="no-slash" />
				</BlockRendererRegistryProvider>,
			);
		});
		await flush();
		expect(probeText()).toBe(`fallback:${BlockRendererFallbackReason.Invalid}`);
		expect(resolver).not.toHaveBeenCalled();
	});
});
