import "@brainstorm/sdk/app-theme.css";
import "@brainstorm/sdk/empty-state.css";
import "@brainstorm/editor/editor.css";
import { AppErrorBoundary } from "@brainstorm/sdk/error-boundary";
import { mountMenuHost } from "@brainstorm/sdk/menus";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BooksApp } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("books: #root not found in index.html");

document.body.classList.remove("is-booting");

// Stand up the fancy-menus runtime so the library sort menu + the header
// object ⋯ menu render through the shared themed surfaces.
mountMenuHost();

createRoot(root).render(
	<StrictMode>
		<AppErrorBoundary appName="books">
			<BooksApp />
		</AppErrorBoundary>
	</StrictMode>,
);
