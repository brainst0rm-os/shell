/// <reference types="vite/client" />
// Gives the `*?worker&inline` import in `render/layout-driver.ts` its
// `{ new (): Worker }` default-export type. The inline form is required
// because the shell loads apps over `file://` (see launcher.ts) where a
// `new Worker(new URL(...), {type:'module'})` can't be constructed —
// Vite bundles the worker as a Blob instead.
