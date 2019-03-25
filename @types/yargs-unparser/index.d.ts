// // declare module 'yargs-unparser' = function unparse(o: object): string[];
// declare module 'yargs-unparser' {
//   function unparse(o: object): string[];
//   // export  typeof unparse;
//   export = unparse;
//   // export default () V ;k
// }

declare module 'yargs-unparser' {
  function unparse(o: object, c: { command?: string, alias?: object, default?: object }): string[];
  export = unparse
}
