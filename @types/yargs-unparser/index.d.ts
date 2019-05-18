declare module 'yargs-unparser' {
  function unparse(o: object, c: { command?: string, alias?: object, default?: object }): string[];
  export = unparse
}
