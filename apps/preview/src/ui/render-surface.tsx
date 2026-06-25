/**
 * `<RenderSurface>` — the ref boundary between React chrome and the
 * imperative per-kind renderer modules. Each renderer (image / video /
 * audio / code / markdown / text / pdf) owns its own DOM subtree and is
 * mounted/disposed imperatively per [[preview-drop-pattern]]; React owns
 * everything around it (header, inspector, filmstrip, empty/unavailable
 * states). This component reconciles the active file → renderer module
 * lifecycle inside a single host element it never lets React touch.
 *
 * The host element is wiped before every mount; `dispose()` is called on
 * unmount and on every file change so renderers release object URLs,
 * abort fetches, and detach listeners.
 */

import { type ReactElement, useEffect, useRef } from "react";
import type { PreviewFile } from "../demo/dataset";
import { getPreviewRuntime } from "../host/runtime";
import { t } from "../i18n";
import { previewKindFor } from "../logic/preview-kind-for";
import { loaderFor } from "../logic/registry";
import type { InspectorPairs } from "./inspector";

/** Hand a PDF link's web URL to the browser app via the `open` intent
 *  (`intents.dispatch:open`, a Preview grant). No-op when the host has no
 *  intents service (tests / standalone). */
function openExternalUrl(url: string): void {
	void getPreviewRuntime()?.services?.intents?.dispatch({ verb: "open", payload: { url } });
}

function titleCase(s: string): string {
	if (!s) return s;
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function describeError(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	return "unknown";
}

export function RenderSurface({
	file,
	onMetadata,
}: {
	file: PreviewFile;
	onMetadata: (pairs: InspectorPairs) => void;
}): ReactElement {
	const hostRef = useRef<HTMLDivElement>(null);
	const onMetadataRef = useRef(onMetadata);
	onMetadataRef.current = onMetadata;

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		let disposed = false;
		let instance: { dispose(): void } | null = null;
		host.replaceChildren();
		// Drop the previous file's inspector pairs synchronously — the new
		// metadata (if any) arrives once the renderer mounts.
		onMetadataRef.current([]);

		const kind = previewKindFor(file.info.mime);
		if (!kind) {
			renderUnavailable(host, t("stage.noPreviewFor", { mime: file.info.mime }));
			onMetadataRef.current([]);
			return;
		}
		const loader = loaderFor(kind);
		if (!loader) {
			renderUnavailable(host, t("stage.rendererNotWired", { kind }));
			onMetadataRef.current([]);
			return;
		}

		const surface = document.createElement("div");
		surface.className = "preview__render-surface";
		host.replaceChildren(surface);

		void (async () => {
			try {
				const module = await loader();
				if (disposed) return;
				instance = await module.mount({
					source: file.source,
					file: file.info,
					host: surface,
					openExternalUrl,
				});
				let pairs: InspectorPairs = [];
				if (module.extractMetadata) {
					try {
						const meta = await module.extractMetadata(file.source);
						if (disposed) return;
						pairs = Object.entries(meta).map(([k, v]) => [titleCase(k), v] as const);
					} catch {
						pairs = [];
					}
				}
				onMetadataRef.current(pairs);
			} catch (err) {
				if (disposed) return;
				renderUnavailable(host, t("stage.rendererFailed", { detail: describeError(err) }));
				onMetadataRef.current([]);
			}
		})();

		return () => {
			disposed = true;
			if (instance) {
				try {
					instance.dispose();
				} catch {
					// dispose is best-effort — a faulty renderer must never wedge the host.
				}
			}
			host.replaceChildren();
		};
	}, [file]);

	return <div ref={hostRef} className="preview__render-host" />;
}

function renderUnavailable(host: HTMLElement, message: string): void {
	const wrap = document.createElement("div");
	wrap.className = "preview__unavailable";
	const heading = document.createElement("p");
	heading.textContent = t("stage.unavailable");
	const detail = document.createElement("p");
	detail.className = "preview__unavailable-detail";
	detail.textContent = message;
	wrap.append(heading, detail);
	host.replaceChildren(wrap);
}
