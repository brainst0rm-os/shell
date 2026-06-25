/**
 * Database's view of the in-memory vault shape. The `EntityRow` / `LinkRow`
 * shapes and `readPropertyPath` live in `@brainstorm/sdk/in-memory-entities`
 * (shared with the Graph app); this module re-exports them under the names
 * the Database renderer uses (`InMemoryEntities`, `emptyEntities`).
 */

export {
	type EntityRow,
	type LinkRow,
	type InMemoryVault as InMemoryEntities,
	emptyVault as emptyEntities,
	readPropertyPath,
} from "@brainstorm/sdk/in-memory-entities";
