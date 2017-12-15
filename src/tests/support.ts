import * as _ from 'lodash';

import * as pre from '../preprocess';
import * as yaml from '../yaml';
import * as jsyaml from 'js-yaml';

export async function transform(input0: any, inputLoader = pre.readFromImportLocation) {
  const input = _.isString(input0) ? yaml.loadString(input0, 'root') : input0;
  return pre.transform(input, "root", inputLoader);
}

export function transformNoImport(input0: any, accumulatedImports = []) {
  const input = _.isString(input0) ? yaml.loadString(input0, 'root') : input0;
  return pre.transformPostImports(input, "root", accumulatedImports);
}

export const $let = (input: any) => new yaml.$let(input);

export type ImportLoader = typeof pre.readFromImportLocation;

export function mkMockImportLoader(table: {[key: string]: {data: string, doc?: any}}): ImportLoader {
  async function mockImportLoader(location: pre.ImportLocation, baseLocation: pre.ImportLocation) {
    const {data, doc} = table[location];
    return {
      importType: pre.parseImportType(location, baseLocation),
      resolvedLocation: location,
      data: data,
      doc: doc || data
    };
  }
  return mockImportLoader;
}
