import { describe, expect, it } from "vitest";
import {
	ActionId,
	_defaultChordsForTesting,
	bindShortcut,
	isTypingTarget,
	matchesChord,
} from "./shortcuts";

type FakeEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
	defaultPrevented?: boolean;
	target?: EventTarget | null;
};

function evt(init: Partial<FakeEvent>): KeyboardEvent {
	let prevented = init.defaultPrevented ?? false;
	const base = {
		key: "",
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		target: null,
		...init,
		get defaultPrevented() {
			return prevented;
		},
		preventDefault() {
			prevented = true;
		},
		stopPropagation() {},
	};
	return base as unknown as KeyboardEvent;
}

function makeSpyTarget(): {
	target: EventTarget;
	dispatch: (event: KeyboardEvent) => void;
	listenerCount: () => number;
} {
	const listeners = new Set<EventListener>();
	const target: EventTarget = {
		addEventListener: ((_type: string, listener: EventListener) => {
			listeners.add(listener);
		}) as EventTarget["addEventListener"],
		removeEventListener: ((_type: string, listener: EventListener) => {
			listeners.delete(listener);
		}) as EventTarget["removeEventListener"],
		dispatchEvent: (() => true) as EventTarget["dispatchEvent"],
	};
	return {
		target,
		dispatch: (event) => {
			for (const listener of listeners) listener(event);
		},
		listenerCount: () => listeners.size,
	};
}

describe("matchesChord", () => {
	it("matches a bare key with no modifiers", () => {
		expect(matchesChord(evt({ key: "Escape" }), "Escape")).toBe(true);
		expect(matchesChord(evt({ key: "F2" }), "F2")).toBe(true);
	});

	it("requires every modifier the chord lists and rejects extras", () => {
		const event = evt({ key: "g", metaKey: true });
		expect(matchesChord(event, "CmdOrCtrl+G")).toBe(true);
		expect(matchesChord(event, "CmdOrCtrl+Shift+G")).toBe(false);
	});

	it("normalizes space and single-char keys case-insensitively", () => {
		expect(matchesChord(evt({ key: " " }), "Space")).toBe(true);
		expect(matchesChord(evt({ key: "s" }), "S")).toBe(true);
	});

	it("treats CmdOrCtrl as Cmd on mac and Ctrl elsewhere", () => {
		const originalNavigator = (globalThis as { navigator?: Navigator }).navigator;
		try {
			Object.defineProperty(globalThis, "navigator", {
				value: { platform: "MacIntel", userAgent: "" },
				configurable: true,
				writable: true,
			});
			expect(matchesChord(evt({ key: "a", metaKey: true }), "CmdOrCtrl+A")).toBe(true);
			expect(matchesChord(evt({ key: "a", ctrlKey: true }), "CmdOrCtrl+A")).toBe(false);

			Object.defineProperty(globalThis, "navigator", {
				value: { platform: "Linux x86_64", userAgent: "" },
				configurable: true,
				writable: true,
			});
			expect(matchesChord(evt({ key: "a", ctrlKey: true }), "CmdOrCtrl+A")).toBe(true);
			expect(matchesChord(evt({ key: "a", metaKey: true }), "CmdOrCtrl+A")).toBe(false);
		} finally {
			Object.defineProperty(globalThis, "navigator", {
				value: originalNavigator,
				configurable: true,
				writable: true,
			});
		}
	});
});

describe("bindShortcut", () => {
	it("invokes the handler on a matching dispatch and unbinds on return", () => {
		const spy = makeSpyTarget();
		let fired = 0;
		const off = bindShortcut(ActionId.CreateSticky, () => fired++, {
			target: spy.target as unknown as Window,
		});
		expect(spy.listenerCount()).toBe(1);
		spy.dispatch(evt({ key: "s" }));
		expect(fired).toBe(1);
		off();
		expect(spy.listenerCount()).toBe(0);
	});

	it("fires on any of an action's multiple chords (Delete or Backspace)", () => {
		const spy = makeSpyTarget();
		let fired = 0;
		bindShortcut(ActionId.DeleteNode, () => fired++, {
			target: spy.target as unknown as Window,
		});
		spy.dispatch(evt({ key: "Delete" }));
		spy.dispatch(evt({ key: "Backspace" }));
		expect(fired).toBe(2);
	});

	it("ignores non-matching chords", () => {
		const spy = makeSpyTarget();
		let fired = 0;
		bindShortcut(ActionId.CreateSticky, () => fired++, {
			target: spy.target as unknown as Window,
		});
		spy.dispatch(evt({ key: "g", metaKey: true }));
		expect(fired).toBe(0);
	});

	it("respects defaultPrevented and skips the handler", () => {
		const spy = makeSpyTarget();
		let fired = 0;
		bindShortcut(ActionId.CreateSticky, () => fired++, {
			target: spy.target as unknown as Window,
		});
		spy.dispatch(evt({ key: "s", defaultPrevented: true }));
		expect(fired).toBe(0);
	});

	it("returns a no-op unbinder when the action's chord is disabled", () => {
		const off = bindShortcut(ActionId.CreateSticky, () => {}, { chord: null });
		expect(off).toBeTypeOf("function");
		expect(() => off()).not.toThrow();
	});

	it("declares at least one chord for every action id in the registry", () => {
		const chords = _defaultChordsForTesting();
		for (const id of Object.values(ActionId)) {
			expect(chords[id]).toBeDefined();
			expect(chords[id].length).toBeGreaterThan(0);
		}
	});

	it("ClearSelection shares Escape with CancelEdit (deselect when no edit open)", () => {
		const chords = _defaultChordsForTesting();
		expect(chords[ActionId.ClearSelection]).toEqual(["Escape"]);
		expect(chords[ActionId.CancelEdit]).toEqual(["Escape"]);
	});

	it("ToggleBold / ToggleItalic bind the standard rich-text chords (9.17.12)", () => {
		const chords = _defaultChordsForTesting();
		expect(chords[ActionId.ToggleBold]).toEqual(["CmdOrCtrl+B"]);
		expect(chords[ActionId.ToggleItalic]).toEqual(["CmdOrCtrl+I"]);
	});

	it("skips bare-key chords when focus is in a text input", () => {
		const spy = makeSpyTarget();
		let fired = 0;
		bindShortcut(ActionId.CreateSticky, () => fired++, {
			target: spy.target as unknown as Window,
		});
		spy.dispatch(evt({ key: "s", target: mockInput("text") }));
		expect(fired).toBe(0);
	});

	it("still fires bare-key chords when focus is outside any text input", () => {
		const spy = makeSpyTarget();
		let fired = 0;
		bindShortcut(ActionId.CreateSticky, () => fired++, {
			target: spy.target as unknown as Window,
		});
		spy.dispatch(evt({ key: "s", target: mockButton() }));
		expect(fired).toBe(1);
	});

	it("honours allowInTyping so cancel-edit escapes the inline editor", () => {
		const spy = makeSpyTarget();
		let fired = 0;
		bindShortcut(ActionId.CancelEdit, () => fired++, {
			target: spy.target as unknown as Window,
			allowInTyping: true,
		});
		spy.dispatch(evt({ key: "Escape", target: mockContentEditable() }));
		expect(fired).toBe(1);
	});

	it("does not consume the event when the handler runs inside a typing target", () => {
		const spy = makeSpyTarget();
		bindShortcut(ActionId.CommitEdit, () => {}, {
			target: spy.target as unknown as Window,
			allowInTyping: true,
		});
		const event = evt({ key: "Enter", metaKey: true, target: mockContentEditable() });
		spy.dispatch(event);
		expect(event.defaultPrevented).toBe(false);
	});

	it("consumes the event by default when fired outside a typing target", () => {
		const spy = makeSpyTarget();
		bindShortcut(ActionId.CreateText, () => {}, {
			target: spy.target as unknown as Window,
		});
		const event = evt({ key: "t", target: mockButton() });
		spy.dispatch(event);
		expect(event.defaultPrevented).toBe(true);
	});
});

describe("isTypingTarget", () => {
	it("returns true for editable inputs", () => {
		for (const type of ["", "text", "search", "url", "email", "tel", "password", "number"]) {
			expect(isTypingTarget(mockInput(type))).toBe(true);
		}
	});

	it("returns false for non-text inputs", () => {
		for (const type of ["button", "submit", "checkbox", "radio", "file", "color"]) {
			expect(isTypingTarget(mockInput(type))).toBe(false);
		}
	});

	it("returns true for textarea and contenteditable, false for buttons and null", () => {
		expect(isTypingTarget(mockTextarea())).toBe(true);
		expect(isTypingTarget(mockContentEditable())).toBe(true);
		expect(isTypingTarget(mockButton())).toBe(false);
		expect(isTypingTarget(null)).toBe(false);
		expect(isTypingTarget(undefined)).toBe(false);
	});

	it("falls back to the contenteditable attribute where isContentEditable is unimplemented (F-213)", () => {
		for (const attr of ["", "true", "plaintext-only"]) {
			expect(isTypingTarget(mockAttrContentEditable(attr))).toBe(true);
		}
		expect(isTypingTarget(mockAttrContentEditable("false"))).toBe(false);
		expect(isTypingTarget(mockAttrContentEditable(null))).toBe(false);
	});
});

function mockInput(type: string): EventTarget {
	return { tagName: "INPUT", type, isContentEditable: false } as unknown as EventTarget;
}
function mockTextarea(): EventTarget {
	return { tagName: "TEXTAREA", isContentEditable: false } as unknown as EventTarget;
}
function mockContentEditable(): EventTarget {
	return { tagName: "DIV", isContentEditable: true } as unknown as EventTarget;
}
/** A jsdom-shaped element: no `isContentEditable`, only the attribute. */
function mockAttrContentEditable(attr: string | null): EventTarget {
	return {
		tagName: "DIV",
		getAttribute: (name: string) => (name === "contenteditable" ? attr : null),
	} as unknown as EventTarget;
}
function mockButton(): EventTarget {
	return { tagName: "BUTTON", isContentEditable: false } as unknown as EventTarget;
}
