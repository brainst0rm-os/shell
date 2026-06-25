/**
 * `mountMenuHost` — stand up a fancy-menus runtime in a renderer that has no
 * React tree wrapping its menu call sites (the imperative-dominant apps:
 * database, graph, tasks, …). It mounts a dedicated React root rendering a
 * childless `<BrainstormMenuProvider>`, which publishes the store to the
 * active-store singleton and portals the menu stack to `document.body`.
 *
 * After this runs, the imperative openers (`openContextMenu`, and the
 * `openAnchoredMenu` that the object / graph / database menus call) resolve
 * the published store and render through the menu runtime. Call once at app
 * boot; the returned disposer unmounts the host.
 *
 * React apps that already wrap their tree in `<BrainstormMenuProvider>` don't
 * need this — but it's harmless to use either way (one provider per renderer).
 */

import { createRoot } from "react-dom/client";
import { BrainstormMenuProvider, type BrainstormMenuProviderProps } from "./provider";

export type MountMenuHostOptions = Pick<BrainstormMenuProviderProps, "locale" | "onError">;

export function mountMenuHost(options: MountMenuHostOptions = {}): () => void {
	if (typeof document === "undefined") return () => {};
	const host = document.createElement("div");
	host.setAttribute("data-fm-host", "");
	document.body.appendChild(host);
	const root = createRoot(host);
	root.render(<BrainstormMenuProvider {...options} />);
	return () => {
		root.unmount();
		host.remove();
	};
}
