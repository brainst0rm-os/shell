import { defineConfig } from "vite";
import { blockBuildConfig } from "../../scripts/vite-block-config";

// BP block bundle build — see `scripts/vite-block-config.ts`.
export default defineConfig(
	blockBuildConfig({
		appDir: __dirname,
		blockName: "embedded-graph",
		globalName: "BrainstormGraphEmbeddedGraph",
	}),
);
