import * as _ from 'lodash';
import {VariablesTrackingVisitor} from './visitor';

export function filter(keys: string[], input: any, filename: string) {
  const visitor = new VariablesTrackingVisitor();
  const env = {
    GlobalAccumulator: {},
    $envValues: {},
    Stack: [{location: filename, path: 'Root'}]
  };
  const output = _.pick(input, ['$imports', '$defs', ...keys]);
  visitor.visitNode(output, 'Root', env);
  if(input.$imports) {
    // Imports are always specified as a shallow object – nested values come from the 
    // object that gets imported. For example:
    //
    //   $imports:
    //     vars: vars.yaml
    //     outputs: cfn:output:my-stack
    //   foo: vars.foo
    //   var: outputs.bar
    //
    // should preserve `vars` and `outputs`. To handle this, we only compare the 
    // first segment of a nested lookup. 
    output.$imports = _.pick(input.$imports, _.map(visitor.variables, (v: string) => v.split('.')[0]));
  }
  if(input.$defs) {
    output.$defs = _.pick(input.$defs, visitor.variables);
  }
  return output;
}
