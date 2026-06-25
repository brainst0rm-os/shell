/**
 * `WhiteboardsRepository` — the storage contract the app's data layer is
 * written against. Implemented by `createEntitiesRepository` (the shared
 * `entities.db` store); the renderer call sites depend only on this type.
 */

import type { WhiteboardEdge } from "../types/edge";
import type { Whiteboard } from "../types/whiteboard";

export type WhiteboardsRepository = {
	listAll(): Promise<{ whiteboards: Whiteboard[]; edges: WhiteboardEdge[] }>;
	saveWhiteboard(whiteboard: Whiteboard): Promise<void>;
	removeWhiteboard(id: string): Promise<void>;
	saveEdge(edge: WhiteboardEdge): Promise<void>;
	removeEdge(id: string): Promise<void>;
};
