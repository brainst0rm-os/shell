import "@brainstorm/sdk/app-theme.css";
import { AppErrorBoundary } from "@brainstorm/sdk/error-boundary";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WhiteboardApp } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("whiteboard: #root not found in index.html");
createRoot(root).render(
	<StrictMode>
		<AppErrorBoundary appName="whiteboard">
			<WhiteboardApp />
		</AppErrorBoundary>
	</StrictMode>,
);
