// @vitest-environment jsdom
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Searchbar } from "./Searchbar";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

function input(): HTMLInputElement {
	const el = container.querySelector<HTMLInputElement>("input[type=search]");
	if (!el) throw new Error("no input rendered");
	return el;
}

function clearButton(): HTMLButtonElement | null {
	return container.querySelector<HTMLButtonElement>(".bs-searchbar__clear");
}

describe("<Searchbar>", () => {
	it("renders an input with placeholder + aria-label and no ✕ by default", () => {
		act(() => {
			root.render(<Searchbar value="" onChange={vi.fn()} placeholder="Find" />);
		});
		expect(input().placeholder).toBe("Find");
		expect(input().getAttribute("aria-label")).toBe("Find");
		expect(clearButton()).toBeNull();
	});

	it("omits the ✕ when value is empty even if clearLabel is provided", () => {
		act(() => {
			root.render(<Searchbar value="" onChange={vi.fn()} placeholder="Find" clearLabel="Clear" />);
		});
		expect(clearButton()).toBeNull();
	});

	it("renders the ✕ when value is non-empty AND clearLabel is set", () => {
		act(() => {
			root.render(<Searchbar value="abc" onChange={vi.fn()} placeholder="Find" clearLabel="Clear" />);
		});
		const btn = clearButton();
		expect(btn).not.toBeNull();
		expect(btn?.getAttribute("aria-label")).toBe("Clear");
	});

	it("fires onChange on typing", () => {
		const onChange = vi.fn();
		act(() => {
			root.render(<Searchbar value="" onChange={onChange} placeholder="Find" />);
		});
		act(() => {
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
			setter?.call(input(), "z");
			input().dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledWith("z");
	});

	it("clicking ✕ calls onChange('') by default", () => {
		function Harness() {
			const [v, setV] = useState("hello");
			return <Searchbar value={v} onChange={setV} placeholder="Find" clearLabel="Clear" />;
		}
		act(() => {
			root.render(<Harness />);
		});
		expect(input().value).toBe("hello");
		act(() => {
			clearButton()?.click();
		});
		expect(input().value).toBe("");
	});

	it("honors a custom onClear handler", () => {
		const onClear = vi.fn();
		const onChange = vi.fn();
		act(() => {
			root.render(
				<Searchbar
					value="x"
					onChange={onChange}
					placeholder="Find"
					clearLabel="Clear"
					onClear={onClear}
				/>,
			);
		});
		act(() => {
			clearButton()?.click();
		});
		expect(onClear).toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
	});
});
