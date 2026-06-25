/**
 * `TasksRepository` — the storage contract the app's data layer is written
 * against. Implemented by `createEntitiesRepository` (the shared
 * `entities.db` store); the renderer call sites depend only on this type.
 */

import type { Project } from "../types/project";
import type { Task } from "../types/task";

export type TasksRepository = {
	listAll(): Promise<{ tasks: Task[]; projects: Project[] }>;
	saveTask(task: Task): Promise<void>;
	deleteTask(id: string): Promise<void>;
	saveProject(project: Project): Promise<void>;
	deleteProject(id: string): Promise<void>;
};
