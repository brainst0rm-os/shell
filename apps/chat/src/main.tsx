import "@brainstorm/editor/editor-theme.css";
import "@brainstorm/sdk/app-theme.css";
import "@brainstorm/sdk/composer-context.css";
import "@brainstorm/sdk/empty-state.css";
import { mountMenuHost } from "@brainstorm/sdk/menus";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatApp } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Chat: #root not found in index.html");
// Stand up the shared fancy-menus runtime (object / context menus).
mountMenuHost();
createRoot(root).render(
	<StrictMode>
		<ChatApp />
	</StrictMode>,
);
