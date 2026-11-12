/** Vite's `?raw` imports (a file's text), used by the tests that read source files. */
declare module "*?raw" {
  const text: string;
  export default text;
}
