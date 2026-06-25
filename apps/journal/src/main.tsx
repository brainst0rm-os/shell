import "@brainstorm/sdk/app-theme.css";
import { AppErrorBoundary } from "@brainstorm/sdk/error-boundary";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JournalApp } from "./app";
import "./types";
import "./styles.css";

const root = document.getElementById("journal-root");
if (!root) throw new Error("journal: #journal-root missing");

document.body.classList.remove("is-booting");

createRoot(root).render(
	<StrictMode>
		<AppErrorBoundary appName="journal">
			<JournalApp />
		</AppErrorBoundary>
	</StrictMode>,
);
