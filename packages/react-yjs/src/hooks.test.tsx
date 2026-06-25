// @vitest-environment jsdom
import { Component, type ReactNode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { AwarenessLike, AwarenessState } from "./awareness";
import { useAwareness, useYDoc, useYMap, useYText, useYXmlFragment } from "./hooks";
import { YDocProvider, type YDocResolver } from "./provider";

// React 19 requires this flag for `act` outside a test framework integration.
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

/** Async `act` so the store's microtask-coalesced notify *and* the
 *  resulting React commit both flush before assertions. */
async function render(node: ReactNode): Promise<void> {
	await act(async () => {
		root.render(node);
	});
}
async function step(fn: () => void): Promise<void> {
	await act(async () => {
		fn();
	});
}

describe("useYText", () => {
	it("renders the text and updates after a (coalesced) transaction", async () => {
		const doc = new Y.Doc();
		const text = doc.getText("t");
		function View() {
			return <span>{useYText(text)}</span>;
		}
		await render(<View />);
		expect(container.textContent).toBe("");
		await step(() =>
			doc.transact(() => {
				text.insert(0, "ab");
				text.insert(2, "cd");
			}),
		);
		expect(container.textContent).toBe("abcd");
	});
});

describe("useYMap", () => {
	it("returns the whole map and a single key", async () => {
		const doc = new Y.Doc();
		const map = doc.getMap<number>("p");
		function Whole() {
			const m = useYMap(map);
			return <span>{[...m.entries()].map(([k, v]) => `${k}=${v}`).join(",")}</span>;
		}
		function Key() {
			return <span>{String(useYMap(map, "x"))}</span>;
		}
		await render(
			<>
				<Whole />
				<Key />
			</>,
		);
		await step(() => map.set("x", 1));
		expect(container.textContent).toBe("x=11");
	});
});

describe("useYXmlFragment", () => {
	it("returns a monotonically increasing change signal", async () => {
		const doc = new Y.Doc();
		const frag = doc.getXmlFragment("frag");
		const seen: number[] = [];
		function View() {
			seen.push(useYXmlFragment(frag));
			return null;
		}
		await render(<View />);
		await step(() => frag.insert(0, [new Y.XmlElement("p")]));
		expect(seen.at(-1)).toBeGreaterThan(seen[0] as number);
	});
});

describe("useYDoc", () => {
	it("subscribes to a directly-passed Y.Doc and re-renders on update", async () => {
		const doc = new Y.Doc();
		let renders = 0;
		function View() {
			renders += 1;
			const d = useYDoc(doc);
			return <span>{d.getMap("m").get("k") as string}</span>;
		}
		await render(<View />);
		const before = renders;
		await step(() => doc.getMap("m").set("k", "v"));
		expect(container.textContent).toBe("v");
		expect(renders).toBeGreaterThan(before);
	});

	it("throws a Stage-9.3 pointer when used by id without a provider", async () => {
		class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
			override state: { error?: Error } = {};
			static getDerivedStateFromError(error: Error) {
				return { error };
			}
			override render() {
				return this.state.error ? <em>{this.state.error.message}</em> : this.props.children;
			}
		}
		function ById() {
			useYDoc("entity_123");
			return null;
		}
		await render(
			<Boundary>
				<ById />
			</Boundary>,
		);
		expect(container.textContent).toContain("Stage 9.3");
	});

	it("resolves by id through a YDocProvider and releases the handle on unmount", async () => {
		const doc = new Y.Doc();
		const release = vi.fn();
		const resolver: YDocResolver = vi.fn(() => ({ doc, release }));
		function ById() {
			const d = useYDoc("entity_1");
			return <span>{String(d === doc)}</span>;
		}
		await render(
			<YDocProvider resolver={resolver}>
				<ById />
			</YDocProvider>,
		);
		expect(container.textContent).toBe("true");
		expect(resolver).toHaveBeenCalledWith("entity_1");
		await act(async () => root.unmount());
		expect(release).toHaveBeenCalledTimes(1);
	});
});

describe("useAwareness", () => {
	it("reflects state and routes setters through the awareness instance", async () => {
		const handlers = new Set<() => void>();
		const states = new Map<number, AwarenessState>();
		const awareness: AwarenessLike = {
			clientID: 1,
			getLocalState: () => states.get(1) ?? null,
			setLocalState: (s) => {
				if (s === null) states.delete(1);
				else states.set(1, s);
				for (const h of handlers) h();
			},
			setLocalStateField(field, value) {
				this.setLocalState({ ...(this.getLocalState() ?? {}), [field]: value });
			},
			getStates: () => states,
			on: (_e, h) => {
				handlers.add(h);
			},
			off: (_e, h) => {
				handlers.delete(h);
			},
		};
		function View() {
			const a = useAwareness(awareness);
			return (
				<button type="button" onClick={() => a.setLocalStateField("cursor", 5)}>
					{JSON.stringify(a.local)}
				</button>
			);
		}
		await render(<View />);
		expect(container.textContent).toBe("null");
		await step(() => {
			container.querySelector("button")?.click();
		});
		expect(container.textContent).toBe('{"cursor":5}');
	});
});
