import {expect} from 'chai';
import * as yaml from '../yaml';
import * as pre from '../preprocess';
import {VariablesVisitor} from '../preprocess/visitor';

const mkTestEnv = ($envValues: pre.$EnvValues, GlobalAccumulator = {}) => ({
  GlobalAccumulator,
  $envValues,
  Stack: []
})

describe('VariablesVisitor', () => {
  it('extracts $! variables', function() {
    const visitor = new VariablesVisitor();
    visitor.visitNode({
      foo: new yaml.$include('bar')
    }, 'test', mkTestEnv({bar: 'baz'}));
    expect(visitor.variables).to.deep.equal(['bar'])
  });

  it('extracts handlebars variables', function() {
    const visitor = new VariablesVisitor();
    visitor.visitNode({
      foo: '{{ bar }}'
    }, 'test', mkTestEnv({bar: 'baz'}));
    expect(visitor.variables).to.deep.equal(['bar'])
  });
});
