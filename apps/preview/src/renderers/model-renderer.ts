/**
 * 3D model renderer — 9.20.10.
 *
 * Quick-look viewer for glTF / GLB / OBJ over three.js. three (+ its
 * loaders) is the heavy bundle, so this whole module is reached only
 * through the registry's dynamic `import()` — Preview's cold start never
 * pays the tax unless a 3D file is actually opened.
 *
 * **Render-on-demand, not a perpetual rAF.** A continuous animation loop
 * would burn the GPU/CPU while a static model just sits there. Instead we
 * render once after load and on every OrbitControls `change` / resize —
 * no rAF to leak, no page-visibility pause to wire, and it respects the
 * doc-13 idle-cost posture.
 *
 * `dispose()` is load-bearing: three.js GPU objects (geometries,
 * materials, textures, the WebGL context itself) are not GC-reachable and
 * must be released explicitly, exactly like the Pixi discipline in Graph.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { t } from "../i18n";
import { ModelFormat, fitDistance, modelFormatFor, modelFormatLabel } from "../logic/model-view";
import { ActionId, bindShortcut } from "../shortcuts";
import { PreviewKind } from "../types/preview-kind";
import type { PreviewInstance, PreviewModule, PreviewMountContext } from "../types/preview-module";
import { sourceBytes } from "./media-source";

const CAMERA_FOV_DEG = 50;

async function loadModel(format: ModelFormat, bytes: Uint8Array): Promise<THREE.Object3D> {
	if (format === ModelFormat.Obj) {
		return new OBJLoader().parse(new TextDecoder().decode(bytes));
	}
	// A fresh, byte-offset-zero ArrayBuffer (not SharedArrayBuffer) for the loader.
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	const gltf = await new GLTFLoader().parseAsync(buffer, "");
	return gltf.scene;
}

export const modelRenderer: PreviewModule = {
	kind: PreviewKind.Model,
	async mount(context: PreviewMountContext): Promise<PreviewInstance> {
		return await mount(context);
	},
	extractMetadata(source) {
		// Cheap, parse-free: the format is decided from MIME/extension. We do
		// NOT re-parse the (potentially large) model just to fill the inspector.
		const format = modelFormatFor(source.mime, "");
		return format ? { Format: modelFormatLabel(format) } : {};
	},
};

async function mount(context: PreviewMountContext): Promise<PreviewInstance> {
	const { host, source, file } = context;
	host.replaceChildren();

	const format = modelFormatFor(source.mime, file.name);
	if (!format) throw new Error(t("model.unsupported"));

	const stage = document.createElement("div");
	stage.className = "preview-stage preview-stage--model";
	const canvas = document.createElement("canvas");
	canvas.className = "preview-model-canvas";
	stage.appendChild(canvas);

	const hud = buildHud();
	stage.appendChild(hud.root);
	host.appendChild(stage);

	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
	} catch (err) {
		// No WebGL context (headless / blocked GPU) — surface a clean failure.
		throw new Error(t("model.noWebgl"), { cause: err });
	}
	renderer.setPixelRatio(typeof devicePixelRatio === "number" ? devicePixelRatio : 1);

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.01, 1000);
	scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1));
	const key = new THREE.DirectionalLight(0xffffff, 1.6);
	key.position.set(1, 1.5, 1);
	scene.add(key);

	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = false;

	let disposed = false;
	const renderOnce = (): void => {
		if (!disposed) renderer.render(scene, camera);
	};

	function sizeToHost(): void {
		const w = Math.max(1, stage.clientWidth);
		const h = Math.max(1, stage.clientHeight);
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}

	// Initial camera home — captured after framing so "reset view" restores it.
	const home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

	const object = await loadModel(format, await sourceBytes(source));
	if (disposed) {
		disposeObject(object);
		teardownGl(renderer, controls);
		return { dispose() {} };
	}
	scene.add(object);

	// Center the model at the origin and pull the camera back so the whole
	// bounding sphere is in frame, lit from an isometric-ish angle.
	const box = new THREE.Box3().setFromObject(object);
	const center = box.getCenter(new THREE.Vector3());
	object.position.sub(center);
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const distance = fitDistance(sphere.radius, CAMERA_FOV_DEG);
	camera.near = Math.max(0.001, distance / 1000);
	camera.far = distance * 1000;
	camera.position.set(distance, distance * 0.7, distance);
	camera.lookAt(0, 0, 0);
	camera.updateProjectionMatrix();
	controls.target.set(0, 0, 0);
	home.pos.copy(camera.position);
	home.target.copy(controls.target);

	sizeToHost();
	controls.addEventListener("change", renderOnce);
	controls.update();
	renderOnce();

	function resetView(): void {
		camera.position.copy(home.pos);
		controls.target.copy(home.target);
		controls.update();
		renderOnce();
	}
	hud.reset.addEventListener("click", resetView);
	const unbind = bindShortcut(ActionId.ModelResetView, resetView);

	const ro =
		typeof ResizeObserver !== "undefined"
			? new ResizeObserver(() => {
					sizeToHost();
					renderOnce();
				})
			: null;
	ro?.observe(stage);

	return {
		dispose(): void {
			disposed = true;
			unbind();
			ro?.disconnect();
			controls.removeEventListener("change", renderOnce);
			scene.remove(object);
			disposeObject(object);
			teardownGl(renderer, controls);
			host.replaceChildren();
		},
	};
}

/** Release every GPU resource a loaded model holds — three.js objects are
 *  not freed by GC, so geometries, materials, and their textures must be
 *  disposed by hand on unmount. */
function disposeObject(root: THREE.Object3D): void {
	root.traverse((node) => {
		const mesh = node as Partial<THREE.Mesh>;
		mesh.geometry?.dispose?.();
		const material = mesh.material;
		if (!material) return;
		for (const m of Array.isArray(material) ? material : [material]) {
			for (const value of Object.values(m as unknown as Record<string, unknown>)) {
				if (value instanceof THREE.Texture) value.dispose();
			}
			m.dispose();
		}
	});
}

function teardownGl(renderer: THREE.WebGLRenderer, controls: OrbitControls): void {
	controls.dispose();
	renderer.dispose();
	renderer.forceContextLoss();
}

function buildHud(): { root: HTMLElement; reset: HTMLButtonElement } {
	const root = document.createElement("div");
	root.className = "preview-image-hud preview-model-hud";
	root.setAttribute("aria-label", t("model.toolbar"));
	const reset = document.createElement("button");
	reset.type = "button";
	reset.className = "preview-image-hud__btn";
	reset.setAttribute("aria-label", t("model.resetView"));
	reset.dataset.bsTooltip = t("model.resetViewTitle");
	reset.textContent = "⤢";
	root.append(reset);
	return { root, reset };
}
