import {expect} from 'chai';
import * as pre from '../preprocess';
import {VariablesTrackingVisitor, Visitor, _parse$includeKeyChunks} from '../preprocess/visitor';
import * as yaml from '../yaml';

const mkTestEnv = ($envValues: pre.$EnvValues, GlobalAccumulator = {}) => ({
  GlobalAccumulator,
  $envValues,
  Stack: [{location: '0', path: '0'}]
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
    }, 'test', mkTestEnv({foo: {bar: 'baz'}}));
    expect(visitor.variables).to.deep.equal(['foo.bar'])
  });

  it('extracts variables from handlebars functions', function() {
    const visitor = new VariablesTrackingVisitor();
    visitor.visitNode({
      foo: '{{ toLowerCase foo.bar }}'
    }, 'test', mkTestEnv({foo: {bar: 'baz'}}));
    expect(visitor.variables).to.deep.equal(['foo.bar'])
  });

  it('extracts variables from handlebars blocks', function() {
    const visitor = new VariablesTrackingVisitor();
    visitor.visitNode({
      foo: '{{#if foo.bar }}{{/if}}'
    }, 'test', mkTestEnv({foo: {bar: 'baz'}}));
    expect(visitor.variables).to.deep.equal(['foo.bar'])
  });
});


describe('Visitor', () => {
  const visitor = new Visitor();
  const $env = {
    bar: 'baz',
    obj: {
      0: 'zero',
      a: 0,
      b: {
        c: 0,
        d: {
          e: 0,
          f: {g: 0}
        },
        keyC: 'c',
        keyD: 'd'
      },
      keyA: 'a',
      keyB: 'b',
      keyC: 'c',
      keyD: 'd',
      keys: {
        b: 'b'
      }
    },
    key0: '0',
    keyA: 'a',
    keyB: 'b',
    keyC: 'c',
    keyD: 'd',
    keyE: 'e'
  };
  const testEnv = mkTestEnv($env);
  const visit$include = (includeString: string) =>
    visitor.visitNode(new yaml.$include(includeString), 'test', testEnv)

  it('visit$include with no dots', function() {
    expect(visit$include('bar')).to.deep.equal($env.bar)
  });

  it('visit$include with dots', function() {
    expect(visit$include('obj.0')).to.deep.equal($env.obj[0])
    expect(visit$include('obj.a')).to.deep.equal($env.obj.a);
    expect(visit$include('obj.b.c')).to.deep.equal($env.obj.b.c);
    expect(visit$include('obj.b.d')).to.deep.equal($env.obj.b.d);
    expect(visit$include('obj.b.d.e')).to.deep.equal($env.obj.b.d.e);
    expect(visit$include('obj.b.d.f')).to.deep.equal($env.obj.b.d.f);
    expect(visit$include('obj.b.d.f.g')).to.deep.equal($env.obj.b.d.f.g);
  });

  it('visit$include with dynamic sub-keys', function() {
    expect(visit$include('obj[keyA]')).to.deep.equal($env.obj.a)
    expect(visit$include('obj[key0]')).to.deep.equal($env.obj[0])
    expect(visit$include('obj[0]')).to.deep.equal($env.obj[0])
    expect(visit$include('obj[keyB]')).to.deep.equal($env.obj.b)
    expect(visit$include('obj[keyB].c')).to.deep.equal($env.obj.b.c)
    expect(visit$include('obj.keyA')).to.deep.equal($env.obj.keyA)
    expect(visit$include('obj[obj.keyA]')).to.deep.equal($env.obj.a)
    expect(visit$include('obj[obj.keyB].c')).to.deep.equal($env.obj.b.c)
    expect(visit$include('obj.keys[keyB]')).to.deep.equal('b')
  });

  it('visit$include with multiple dynamic sub-keys', function() {
    expect(visit$include('obj[keyB][keyC]')).to.deep.equal($env.obj.b.c)
    expect(visit$include('obj[keyB][obj.keyC]')).to.deep.equal($env.obj.b.c)
    expect(visit$include('obj[obj.keyB][obj.keyC]')).to.deep.equal($env.obj.b.c)
    expect(visit$include('obj[obj.keys[keyB]].c')).to.deep.equal($env.obj.b.c)
    expect(visit$include('obj[keyB][obj.keyD].e')).to.deep.equal($env.obj.b.d.e)
    expect(visit$include('obj.b[obj[keyB].keyC]')).to.deep.equal($env.obj.b.c)
    expect(visit$include('obj.b[obj[keyB].keyD].e')).to.deep.equal($env.obj.b.d.e)
    expect(visit$include('obj.b[obj[keyB].keyD][keyE]')).to.deep.equal($env.obj.b.d.e)
  });

});

describe('_parse$includeKeyChunks', () => {
  it('all examples parse correctly', () => {
    const examples = {
      'foo': ['foo'],
      'foo[sub]': ['foo[sub]'],
      'foo.bar': ['foo', 'bar'],
      'foo.bar.baz': ['foo', 'bar', 'baz'],
      'foo[sub].bar': ['foo[sub]', 'bar'],
      'foo[sub].bar.baz': ['foo[sub]', 'bar', 'baz'],
      'foo[sub].bar.baz[sub2]': ['foo[sub]', 'bar', 'baz[sub2]'],
      'foo.bar[sub].baz': ['foo', 'bar[sub]', 'baz'],
      'foo[sub0.sub1].bar': ['foo[sub0.sub1]', 'bar'],
      'foo[sub0][sub1].bar': ['foo[sub0][sub1]', 'bar'],
      'foo[sub0][sub1].bar[sub3]': ['foo[sub0][sub1]', 'bar[sub3]']
    }
    for (const [key, res] of Object.entries(examples)) {
      const errorMsg = `input=${key}`;
      expect(_parse$includeKeyChunks(key, 'test'), errorMsg).to.deep.equal(res);
    }
  })
})
