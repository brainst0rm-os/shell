import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Per-app Vite build (mirrors apps/files/vite.config.ts). Source under
// `src/`; `src/index.html` is the entry; output to `dist/`. Loaded over
// `file://` by the shell, so `base: "./"` keeps asset refs relative.
export default defineConfig({
	root: resolve(__dirname, "src"),
	base: "./",
	plugins: [react()],
	build: {
		outDir: resolve(__dirname, "dist"),
		emptyOutDir: true,
		minify: false,
		sourcemap: true,
		target: "chrome130",
		rollupOptions: { input: resolve(__dirname, "src/index.html") },
	},
});
