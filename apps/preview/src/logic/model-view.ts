/**
 * 3D model view keystone — 9.20.10.
 *
 * Pure, DOM-free, three.js-free helpers for the model renderer: which
 * loader a file needs (`modelFormatFor`) and the camera-framing math
 * (`fitDistance`). Kept separate so the heavy three.js render path stays
 * untested-in-jsdom (WebGL is unavailable there — exercised in the real
 * shell, like the PDF canvas/worker) while the decisions around it are
 * unit-covered.
 */

/** The three loader families the model renderer dispatches on. `glb` is
 *  binary glTF, `gltf` is JSON glTF — both go through `GLTFLoader`; `obj`
 *  goes through `OBJLoader`. */
export enum ModelFormat {
	Gltf = "gltf",
	Glb = "glb",
	Obj = "obj",
}

/** Exact model MIME → format. */
const MODEL_MIME: Readonly<Record<string, ModelFormat>> = {
	"model/gltf-binary": ModelFormat.Glb,
	"model/gltf+json": ModelFormat.Gltf,
	"model/obj": ModelFormat.Obj,
	// Wavefront OBJ has no IANA type; these are the de-facto ones servers emit.
	"text/prs.wavefront-obj": ModelFormat.Obj,
	"application/x-tgif": ModelFormat.Obj,
};

/** Filename extension → format — the fallback when the MIME is generic
 *  (`application/octet-stream`) or absent, which is common for 3D assets. */
const MODEL_EXT: Readonly<Record<string, ModelFormat>> = {
	glb: ModelFormat.Glb,
	gltf: ModelFormat.Gltf,
	obj: ModelFormat.Obj,
};

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	if (dot < 0 || dot === name.length - 1) return "";
	return name.slice(dot + 1).toLowerCase();
}

/** Resolve the loader format for a file. Prefers the MIME, falls back to
 *  the filename extension (3D assets routinely arrive as octet-stream).
 *  Returns `null` when neither names a format the renderer can load. */
export function modelFormatFor(mime: string, name: string): ModelFormat | null {
	const normalised = mime.toLowerCase().split(";")[0]?.trim() ?? "";
	const byMime = MODEL_MIME[normalised];
	if (byMime !== undefined) return byMime;
	const byExt = MODEL_EXT[extensionOf(name)];
	return byExt ?? null;
}

/** Camera distance that frames a bounding sphere of `radius` within a
 *  perspective camera's vertical field of view `fovDeg`, with `margin`
 *  headroom (1 = sphere touches the frame edges). Geometry:
 *  `d = radius / sin(fov/2)`. Guards a degenerate (zero/negative) radius
 *  to a unit fallback so an empty/point model still gets a sane camera. */
export function fitDistance(radius: number, fovDeg: number, margin = 1.25): number {
	const r = radius > 0 ? radius : 1;
	const half = (Math.max(1, Math.min(179, fovDeg)) * Math.PI) / 360;
	return (r / Math.sin(half)) * Math.max(1, margin);
}

/** Human label for the inspector "Format" row. */
export function modelFormatLabel(format: ModelFormat): string {
	switch (format) {
		case ModelFormat.Gltf:
			return "glTF";
		case ModelFormat.Glb:
			return "glTF (binary)";
		case ModelFormat.Obj:
			return "Wavefront OBJ";
	}
}
