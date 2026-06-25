// @vitest-environment jsdom

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EntityCommentsPanel, type EntityMutationServices } from "./entity-comments-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const fullEntities: EntityMutationServices = {
	create: async () => ({ id: "c1" }),
	update: async () => ({ id: "c1" }),
	delete: async () => undefined,
};

function renderPanel(opts: {
	entities: EntityMutationServices;
	documentId: string | null;
	onTabbed: (tabbed: boolean) => void;
}): void {
	act(() => {
		root.render(
			<EntityCommentsPanel
				services={{ vaultEntities: null, entities: opts.entities }}
				documentId={opts.documentId}
				properties={({ tabbed }) => {
					opts.onTabbed(tabbed);
					return <div className="probe-props" data-tabbed={tabbed} />;
				}}
			/>,
		);
	});
}

describe("EntityCommentsPanel", () => {
	it("renders properties bare (no tab strip, tabbed=false) when there is no mutation surface", () => {
		let lastTabbed = true;
		renderPanel({
			entities: null,
			documentId: "ent_doc",
			onTabbed: (t) => {
				lastTabbed = t;
			},
		});
		expect(container.querySelector(".bs-panel-tabs")).toBeNull();
		expect(container.querySelector(".probe-props")?.getAttribute("data-tabbed")).toBe("false");
		expect(lastTabbed).toBe(false);
	});

	it("renders properties bare when there is no documentId", () => {
		let lastTabbed = true;
		renderPanel({
			entities: fullEntities,
			documentId: null,
			onTabbed: (t) => {
				lastTabbed = t;
			},
		});
		expect(container.querySelector(".bs-panel-tabs")).toBeNull();
		expect(lastTabbed).toBe(false);
	});

	it("renders the Properties | Comments tab strip + tabbed properties when mutations + documentId are present", () => {
		let lastTabbed = false;
		renderPanel({
			entities: fullEntities,
			documentId: "ent_doc",
			onTabbed: (t) => {
				lastTabbed = t;
			},
		});
		expect(container.querySelector(".bs-panel-tabs")).not.toBeNull();
		const tabLabels = Array.from(container.querySelectorAll(".bs-panel-tab")).map(
			(n) => n.textContent,
		);
		expect(tabLabels.length).toBe(2);
		expect(lastTabbed).toBe(true);
		expect(container.querySelector(".probe-props")?.getAttribute("data-tabbed")).toBe("true");
	});
});
