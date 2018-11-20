import {expect} from 'chai';
import * as yaml from '../yaml';
import * as pre from '../preprocess';
import {VariablesTrackingVisitor} from '../preprocess/visitor';

const mkTestEnv = ($envValues: pre.$EnvValues, GlobalAccumulator = {}) => ({
  GlobalAccumulator,
  $envValues,
  Stack: [{ location: '0', path: '0' }]
})

describe('VariablesTrackingVisitor', () => {
  it('extracts $! variables', function() {
    const visitor = new VariablesTrackingVisitor();
    visitor.visitNode({
      foo: new yaml.$include('bar')
    }, 'test', mkTestEnv({bar: 'baz'}));
    expect(visitor.variables).to.deep.equal(['bar'])
  });

  it('extracts nested $! variables', function() {
    const visitor = new VariablesTrackingVisitor();
    visitor.visitNode({
      a: new yaml.$include('foo.bar')
    }, 'test', mkTestEnv({foo: {bar: 'baz'}}));
    expect(visitor.variables).to.deep.equal(['foo.bar'])
  });

  it('extracts handlebars variables', function() {
    const visitor = new VariablesTrackingVisitor();
    visitor.visitNode({
      foo: '{{ bar }}'
    }, 'test', mkTestEnv({bar: 'baz'}));
    expect(visitor.variables).to.deep.equal(['bar'])
  });

  it('extracts nested handlebars variables', function() {
    const visitor = new VariablesTrackingVisitor();
    visitor.visitNode({
      foo: '{{ foo.bar }}'
    }, 'test', mkTestEnv({foo: {bar: 'baz'} }));
    expect(visitor.variables).to.deep.equal(['foo.bar'])
  });

  it('extracts variables from handlebars functions', function() {
    const visitor = new VariablesTrackingVisitor();
    visitor.visitNode({
      foo: '{{ toLowerCase foo.bar }}'
    }, 'test', mkTestEnv({foo: {bar: 'baz'} }));
    expect(visitor.variables).to.deep.equal(['foo.bar'])
  });

  it('extracts variables from handlebars blocks', function() {
    const visitor = new VariablesTrackingVisitor();
    visitor.visitNode({
      foo: '{{#if foo.bar }}{{/if}}'
    }, 'test', mkTestEnv({foo: {bar: 'baz'} }));
    expect(visitor.variables).to.deep.equal(['foo.bar'])
  });
});
