import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { appBuildConfig } from "../vite.config.base";

// theme-editor — per-app Vite build. Shared shape lives in apps/vite.config.base.ts;
// only the React plugin is per-app (it resolves from this app's node_modules).
export default defineConfig({ ...appBuildConfig(__dirname), plugins: [react()] });
