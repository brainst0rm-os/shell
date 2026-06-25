/** Side-effect CSS imports (e.g. the lazily-loaded `katex` stylesheet)
 *  carry no type; declare them so `tsc` resolves the specifier. */
declare module "*.css";
