// @vitest-environment jsdom
/**
 * Tiny React test harness — `createRoot` + async `act`, mirroring the
 * automations / whiteboard suites (no @testing-library dependency).
 */

import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type RenderHandle = {
	container: HTMLDivElement;
	root: Root;
	unmount(): Promise<void>;
};

export async function renderInto(node: ReactNode): Promise<RenderHandle> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(node);
	});
	return {
		container,
		root,
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

export async function flush(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
	});
}
