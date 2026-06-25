// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyEscape } from "./focus-trap";
import { InitialFocusMode, _getFocusTrapStackForTests, useFocusTrap } from "./use-focus-trap";

function Trap({
	enabled,
	onEscape,
	initialFocus,
	explicitInitialFocus,
}: {
	enabled: boolean;
	onEscape?: () => void;
	initialFocus?: InitialFocusMode;
	explicitInitialFocus?: HTMLElement | null;
}) {
	const { containerProps } = useFocusTrap({
		enabled,
		...(onEscape !== undefined ? { onEscape } : {}),
		...(initialFocus !== undefined ? { initialFocus } : {}),
		...(explicitInitialFocus !== undefined ? { explicitInitialFocus } : {}),
	});
	return (
		<div {...containerProps} data-testid="trap">
			<button data-testid="first" type="button">
				first
			</button>
			<input data-testid="middle" type="text" />
			<button data-testid="last" type="button">
				last
			</button>
		</div>
	);
}

describe("useFocusTrap", () => {
	let host: HTMLDivElement;
	let root: Root;
	let opener: HTMLButtonElement;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		opener = document.createElement("button");
		opener.textContent = "opener";
		document.body.appendChild(opener);
		opener.focus();
		root = createRoot(host);
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
		opener.remove();
	});

	const q = (sel: string) => host.querySelector<HTMLElement>(`[data-testid="${sel}"]`);
	const press = (target: HTMLElement, init: KeyboardEventInit) => {
		const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
		target.dispatchEvent(ev);
		return ev;
	};

	it("focuses the first focusable on mount", () => {
		act(() => root.render(<Trap enabled={true} />));
		expect(document.activeElement).toBe(q("first"));
	});

	it("Tab from the last focusable wraps to the first", () => {
		act(() => root.render(<Trap enabled={true} />));
		q("last")?.focus();
		expect(document.activeElement).toBe(q("last"));
		act(() => {
			press(q("trap") as HTMLElement, { key: "Tab" });
		});
		expect(document.activeElement).toBe(q("first"));
	});

	it("Shift+Tab from the first focusable wraps to the last", () => {
		act(() => root.render(<Trap enabled={true} />));
		expect(document.activeElement).toBe(q("first"));
		act(() => {
			press(q("trap") as HTMLElement, { key: "Tab", shiftKey: true });
		});
		expect(document.activeElement).toBe(q("last"));
	});

	it("Escape invokes onEscape", () => {
		const onEscape = vi.fn();
		act(() => root.render(<Trap enabled={true} onEscape={onEscape} />));
		act(() => {
			press(q("trap") as HTMLElement, { key: "Escape" });
		});
		expect(onEscape).toHaveBeenCalledTimes(1);
	});

	it("unmount restores focus to the opener", () => {
		act(() => root.render(<Trap enabled={true} />));
		expect(document.activeElement).toBe(q("first"));
		act(() => root.unmount());
		expect(document.activeElement).toBe(opener);
	});

	it("disabling the trap pops the stack and restores opener focus", () => {
		const size = () => _getFocusTrapStackForTests().size();
		const before = size();
		act(() => root.render(<Trap enabled={true} />));
		expect(size()).toBe(before + 1);
		act(() => root.render(<Trap enabled={false} />));
		expect(size()).toBe(before);
		expect(document.activeElement).toBe(opener);
	});

	it("initialFocus=Container focuses the container itself", () => {
		act(() => root.render(<Trap enabled={true} initialFocus={InitialFocusMode.Container} />));
		expect(document.activeElement).toBe(q("trap"));
	});

	it("initialFocus=Explicit focuses the provided element", () => {
		const explicit = document.createElement("button");
		explicit.textContent = "explicit";
		document.body.appendChild(explicit);
		act(() =>
			root.render(
				<Trap
					enabled={true}
					initialFocus={InitialFocusMode.Explicit}
					explicitInitialFocus={explicit}
				/>,
			),
		);
		expect(document.activeElement).toBe(explicit);
		explicit.remove();
	});

	it("initialFocus=Explicit accepts a RefObject, resolved at effect time", () => {
		// The ref is null at first render and only populated when React attaches
		// it during commit — the hook must read `.current` inside its mount effect
		// (after refs attach), not during render. This is the `<Popover
		// initialFocusRef>` path that lands a confirm dialog on its safe default.
		function RefTrap() {
			const ref = React.useRef<HTMLButtonElement | null>(null);
			const { containerProps } = useFocusTrap({
				enabled: true,
				initialFocus: InitialFocusMode.Explicit,
				explicitInitialFocus: ref,
			});
			return (
				<div {...containerProps}>
					<button data-testid="ref-first" type="button">
						first
					</button>
					<button data-testid="ref-target" ref={ref} type="button">
						target
					</button>
				</div>
			);
		}
		act(() => root.render(<RefTrap />));
		expect(document.activeElement).toBe(q("ref-target"));
	});

	it("StrictMode-safe: double-mount leaves exactly one entry on the stack", () => {
		const stack = _getFocusTrapStackForTests();
		const before = stack.size();
		act(() =>
			root.render(
				<React.StrictMode>
					<Trap enabled={true} />
				</React.StrictMode>,
			),
		);
		expect(stack.size()).toBe(before + 1);
		act(() => root.unmount());
		expect(stack.size()).toBe(before);
	});

	it("two nested traps unwind LIFO via applyEscape (sequential open)", () => {
		const stack = _getFocusTrapStackForTests();
		const onEscOuter = vi.fn();
		const onEscInner = vi.fn();
		function Outer({ showInner }: { showInner: boolean }) {
			const { containerProps } = useFocusTrap({ enabled: true, onEscape: onEscOuter });
			const inner = useFocusTrap({ enabled: showInner, onEscape: onEscInner });
			return (
				<div {...containerProps} data-testid="outer">
					<button data-testid="outer-btn" type="button">
						outer
					</button>
					{showInner && (
						<div {...inner.containerProps} data-testid="inner">
							<button data-testid="inner-btn" type="button">
								inner
							</button>
						</div>
					)}
				</div>
			);
		}
		const before = stack.size();
		// Phase 1: open Outer alone → outer is on top.
		act(() => root.render(<Outer showInner={false} />));
		expect(stack.size()).toBe(before + 1);
		// Phase 2: open Inner from within Outer → inner now on top.
		act(() => root.render(<Outer showInner={true} />));
		expect(stack.size()).toBe(before + 2);
		// First applyEscape pops the top, which is now Inner.
		expect(applyEscape(stack)).toBe(true);
		expect(onEscInner).toHaveBeenCalledTimes(1);
		expect(onEscOuter).not.toHaveBeenCalled();
		// Host responds by closing Inner — re-render without it. The hook's
		// cleanup pops the entry.
		act(() => root.render(<Outer showInner={false} />));
		expect(stack.size()).toBe(before + 1);
		// Second applyEscape pops Outer.
		expect(applyEscape(stack)).toBe(true);
		expect(onEscOuter).toHaveBeenCalledTimes(1);
	});
});
