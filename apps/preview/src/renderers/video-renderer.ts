/**
 * Video renderer — 9.20.3.
 *
 * Native `<video controls>` (the platform's scrub bar / volume /
 * fullscreen are already Quick-Look-grade and accessible) inside a
 * letterboxed stage, plus a Picture-in-Picture affordance where the
 * platform supports it. Strictly read-only per OQ-PV-4 — no trimming /
 * annotation. `dispose()` pauses, detaches the source, aborts the
 * in-flight network load (`removeAttribute("src") + load()`) and
 * revokes any owned object URL so navigating the filmstrip never
 * leaks a decoder or a blob.
 *
 * Captions: a sidecar `.vtt` `<track>` lands with 9.20.6 (Files passes
 * siblings) — the element is structured so adding it is a child append,
 * no rework here.
 */

import { formatDuration, formatResolution, shortFormat } from "../logic/media-info";
import { PreviewKind } from "../types/preview-kind";
import type {
	PreviewInstance,
	PreviewModule,
	PreviewMountContext,
	PreviewSource,
} from "../types/preview-module";
import { applySourceToMedia } from "./media-source";

export const videoRenderer: PreviewModule = {
	kind: PreviewKind.Video,
	mount(context: PreviewMountContext): PreviewInstance {
		return mountVideo(context);
	},
	extractMetadata(source) {
		return probeMediaMetadata(source, true);
	},
};

function mountVideo(context: PreviewMountContext): PreviewInstance {
	const { host, source } = context;
	host.replaceChildren();

	const stage = document.createElement("div");
	stage.className = "preview-stage preview-stage--media preview-stage--video";

	const video = document.createElement("video");
	video.className = "preview-video";
	video.controls = true;
	video.playsInline = true;
	video.preload = "metadata";
	video.setAttribute("aria-label", context.file.name);
	const ownedUrl = applySourceToMedia(video, source);

	stage.appendChild(video);

	let pipButton: HTMLButtonElement | null = null;
	if (document.pictureInPictureEnabled) {
		pipButton = document.createElement("button");
		pipButton.type = "button";
		pipButton.className = "preview-media__pip";
		pipButton.textContent = "Picture in Picture";
		pipButton.addEventListener("click", () => {
			void togglePictureInPicture(video);
		});
		stage.appendChild(pipButton);
	}

	host.appendChild(stage);

	return {
		dispose(): void {
			try {
				if (document.pictureInPictureElement === video) {
					void document.exitPictureInPicture().catch(() => {});
				}
				video.pause();
				video.removeAttribute("src");
				video.load();
			} catch {
				// A disposed element throwing on load() must not block teardown.
			}
			if (ownedUrl) URL.revokeObjectURL(ownedUrl);
			host.replaceChildren();
		},
	};
}

async function togglePictureInPicture(video: HTMLVideoElement): Promise<void> {
	try {
		if (document.pictureInPictureElement === video) {
			await document.exitPictureInPicture();
		} else {
			await video.requestPictureInPicture();
		}
	} catch {
		// PiP can reject (no metadata yet / user gesture lost) — non-fatal.
	}
}

/** Best-effort metadata via a detached, metadata-only media element.
 *  Bounded by a timeout so a slow / unseekable stream never wedges the
 *  inspector; every path revokes its own probe URL. */
export function probeMediaMetadata(
	source: PreviewSource,
	wantResolution: boolean,
): Promise<Record<string, string>> {
	const base: Record<string, string> = { Format: shortFormat(source.mime) };
	return new Promise((resolve) => {
		let settled = false;
		const el = document.createElement(wantResolution ? "video" : "audio") as HTMLMediaElement;
		el.preload = "metadata";
		const probeUrl = applySourceToMedia(el, source);
		const finish = (extra: Record<string, string>): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			el.removeAttribute("src");
			try {
				el.load();
			} catch {
				// ignore — probe element is being discarded anyway
			}
			if (probeUrl) URL.revokeObjectURL(probeUrl);
			resolve({ ...base, ...extra });
		};
		const timer = setTimeout(() => finish({}), 4000);
		el.addEventListener("loadedmetadata", () => {
			const extra: Record<string, string> = {
				Duration: formatDuration(el.duration),
			};
			if (wantResolution && el instanceof HTMLVideoElement) {
				const res = formatResolution(el.videoWidth, el.videoHeight);
				if (res) extra.Resolution = res;
			}
			finish(extra);
		});
		el.addEventListener("error", () => finish({}));
	});
}
