import "@brainstorm/sdk/app-theme.css";
import "@brainstorm/sdk/empty-state.css";
import { AppErrorBoundary } from "@brainstorm/sdk/error-boundary";
import { mountMenuHost } from "@brainstorm/sdk/menus";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AutomationsApp } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("automations: #root not found in index.html");

document.body.classList.remove("is-booting");

// Stand up the fancy-menus runtime so the per-row ⋯ overflow + the header
// overflow menus resolve the published store and render themed surfaces.
mountMenuHost();

createRoot(root).render(
	<StrictMode>
		<AppErrorBoundary appName="automations">
			<AutomationsApp />
		</AppErrorBoundary>
	</StrictMode>,
);
