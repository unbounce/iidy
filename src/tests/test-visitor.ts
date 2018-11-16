import {expect} from 'chai';
import * as yaml from '../yaml';
import * as pre from '../preprocess';
import {VariablesVisitor} from '../preprocess/visitor';

const mkTestEnv = ($envValues: pre.$EnvValues, GlobalAccumulator = {}) => ({
  GlobalAccumulator,
  $envValues,
  Stack: [{ location: '0', path: '0' }]
})

describe('VariablesVisitor', () => {
  it('extracts $! variables', function() {
    const visitor = new VariablesVisitor();
    visitor.visitNode({
      foo: new yaml.$include('bar')
    }, 'test', mkTestEnv({bar: 'baz'}));
    expect(visitor.variables).to.deep.equal(['bar'])
  });

  it('extracts nested $! variables', function() {
    const visitor = new VariablesVisitor();
    visitor.visitNode({
      a: new yaml.$include('foo.bar')
    }, 'test', mkTestEnv({foo: {bar: 'baz'}}));
    expect(visitor.variables).to.deep.equal(['foo.bar'])
  });

  it('extracts handlebars variables', function() {
    const visitor = new VariablesVisitor();
    visitor.visitNode({
      foo: '{{ bar }}'
    }, 'test', mkTestEnv({bar: 'baz'}));
    expect(visitor.variables).to.deep.equal(['bar'])
  });

  it('extracts nested handlebars variables', function() {
    const visitor = new VariablesVisitor();
    visitor.visitNode({
      foo: '{{ foo.bar }}'
    }, 'test', mkTestEnv({foo: {bar: 'baz'} }));
    expect(visitor.variables).to.deep.equal(['foo.bar'])
  });
});
