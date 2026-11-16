/** Vitest (Vite) loads `?raw` imports as text; tests use them for recorded fixtures. */
declare module '*?raw' {
  const text: string;
  export default text;
}
