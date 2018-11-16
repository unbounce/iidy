import * as _ from 'lodash';
import * as yaml from '../yaml';
import {VariablesVisitor} from './visitor';

export function filter(keys: string[], input: any, filename: string) {
  const visitor = new VariablesVisitor();
  const env = {
    GlobalAccumulator: {},
    $envValues: {},
    Stack: [{location: filename, path: 'Root'}]
  };
  const output = _.pick(input, keys);
  visitor.visitNode(output, 'Root', env);
  if(input.$imports) {
    output.$imports = _.pick(input.$imports, visitor.variables);
  }
  if(input.$defs) {
    output.$defs = _.pick(input.$defs, visitor.variables);
  }
  return output;
}
