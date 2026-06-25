// @vitest-environment jsdom

/**
 * B6.4b render-half wiring — `TransclusionNode`'s decorator decides against
 * the live ancestor chain (`decideTransclusionRender`) and either mounts the
 * injected body renderer or collapses to a muted "open source" note.
 *
 * The pure cycle/depth math is proven in `transclusion-ops.test.ts`; this
 * exercises the React seam: a STUB `renderBody` stands in for the real nested
 * `<BrainstormEditor>` so we assert the branch taken (and that the renderer is
 * NOT invoked on a cycle/depth elision) without mounting a Yjs-backed editor.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TransclusionView } from "./nodes/transclusion-node";
import {
	type TransclusionBodyRenderer,
	TransclusionRenderProvider,
} from "./transclusion-render-context";

const TARGET = "n_target";
const TYPE = "io.brainstorm.notes/Note/v1";

type Harness = { container: HTMLDivElement; root: Root };

let harness: Harness;

beforeEach(() => {
	const container = document.createElement("div");
	document.body.append(container);
	harness = { container, root: createRoot(container) };
});

afterEach(() => {
	act(() => harness.root.unmount());
	harness.container.remove();
});

function makeRenderer(): TransclusionBodyRenderer & { calls: { entityId: string }[] } {
	const calls: { entityId: string }[] = [];
	const fn: TransclusionBodyRenderer = ({ entityId, chain }) => {
		calls.push({ entityId });
		return (
			<div data-testid="body" data-chain={chain.join(",")}>
				body
			</div>
		);
	};
	return Object.assign(fn, { calls });
}

function render(chain: readonly string[], renderBody: TransclusionBodyRenderer | null): void {
	act(() => {
		harness.root.render(
			<TransclusionRenderProvider ancestorChain={chain} renderBody={renderBody}>
				<TransclusionView entityId={TARGET} entityType={TYPE} label="Target" />
			</TransclusionRenderProvider>,
		);
	});
}

describe("TransclusionNode render decision (B6.4b)", () => {
	it("mounts the injected body when the target is not in the chain", () => {
		const renderer = makeRenderer();
		render(["n_host"], renderer);
		expect(harness.container.querySelector('[data-decision="render"]')).not.toBeNull();
		expect(harness.container.querySelector('[data-testid="body"]')).not.toBeNull();
		expect(renderer.calls).toEqual([{ entityId: TARGET }]);
		expect(harness.container.querySelector(".notes__transclusion-elided")).toBeNull();
	});

	it("passes the host-first chain (excluding the target) to the renderer", () => {
		const renderer = makeRenderer();
		render(["n_host", "n_mid"], renderer);
		expect(harness.container.querySelector('[data-testid="body"]')?.getAttribute("data-chain")).toBe(
			"n_host,n_mid",
		);
	});

	it("elides (no renderer call) when the target is already an ancestor", () => {
		const renderer = makeRenderer();
		render(["n_host", TARGET], renderer);
		expect(harness.container.querySelector('[data-decision="cycle-elided"]')).not.toBeNull();
		expect(harness.container.querySelector(".notes__transclusion-elided")).not.toBeNull();
		expect(harness.container.querySelector('[data-testid="body"]')).toBeNull();
		expect(renderer.calls).toEqual([]);
	});

	it("elides on depth once the chain hits the budget", () => {
		const renderer = makeRenderer();
		// MAX_TRANSCLUSION_DEPTH = 10; a 10-deep chain (none equal to the
		// target) trips the depth branch, not the cycle branch.
		const deep = Array.from({ length: 10 }, (_, i) => `n_${i}`);
		render(deep, renderer);
		expect(harness.container.querySelector('[data-decision="depth-elided"]')).not.toBeNull();
		expect(renderer.calls).toEqual([]);
	});

	it("renders only the header card when no renderer is wired (degraded mount)", () => {
		render(["n_host"], null);
		expect(harness.container.querySelector(".notes__transclusion-card")).not.toBeNull();
		expect(harness.container.querySelector('[data-testid="body"]')).toBeNull();
		expect(harness.container.querySelector(".notes__transclusion-elided")).toBeNull();
	});
});
