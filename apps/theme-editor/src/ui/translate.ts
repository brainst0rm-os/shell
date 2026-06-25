/**
 * The widened translator the generic panes take — a `(key, params?) =>
 * string`. The app's `t` has a narrower literal-key domain; `translate`
 * (app.tsx) bridges the two so panes stay decoupled from the catalog type.
 */

export type Translate = (key: string, params?: Record<string, string>) => string;
