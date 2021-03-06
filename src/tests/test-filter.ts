import * as _ from 'lodash';
import {expect} from 'chai';

import * as yaml from '../yaml';
import {filter} from '../preprocess/filter';

describe('filter', () => {
  it('filters keys, $imports, and $defs', function() {
    const input = {
      $defs: {
        a: 1,
        b: 2
      },
      $imports: {
        c: 3,
        d: 4
      },
      one: new yaml.$include('a'),
      two: new yaml.$include('b'),
      three: new yaml.$include('c'),
      four: new yaml.$include('d'),
    };
    const filtered = filter(['two', 'three'], input, 'test');
    expect(_.keys(filtered)).to.members(['two', 'three', '$imports', '$defs']);
    expect(_.keys(filtered.$defs)).to.members(['b']);
    expect(_.keys(filtered.$imports)).to.members(['c']);

  });

  it('filters nested keys', function() {
    const input = {
      $defs: {
        a: {
          b: 1
        },
        c: {
          d: 2,
          e: 3
        }
      },
      one: new yaml.$include('a.b'),
      two: new yaml.$include('c.d'),
    };
    const filtered = filter(['two'], input, 'test');
    expect(_.keys(filtered)).to.members(['two', '$defs']);
    expect(_.keys(filtered.$defs)).to.members(['c']);
    expect(_.keys(filtered.$defs.c)).to.members(['d']);
  });

  it('retains chained variables in $imports, and $defs', function() {
    const input = {
      $defs: {
        chained: 1,
        a: new yaml.$include('chained'),
        b: 2
      },
      one: new yaml.$include('a')
    };
    const filtered = filter(['one'], input, 'test');
    expect(_.keys(filtered)).to.members(['one', '$defs']);
    expect(_.keys(filtered.$defs)).to.members(['a', 'chained']);
  });

  it('retains imported files', function() {
    const input = {
      $imports: {
        vars: 'vars.yaml'
      },
      one: new yaml.$include('vars.foo')
    };
    const filtered = filter(['one'], input, 'test');
    expect(_.keys(filtered)).to.members(['one', '$imports']);
    expect(_.keys(filtered.$imports)).to.members(['vars']);
  });

  it('retains imported files using handlebars templating', function() {
    const input = {
      $imports: {
        vars: 'vars.yaml'
      },
      one: '{{vars.foo}}'
    };
    const filtered = filter(['one'], input, 'test');
    expect(_.keys(filtered)).to.members(['one', '$imports']);
    expect(_.keys(filtered.$imports)).to.members(['vars']);
  });

  it('filters transitive dependencies', function() {
    const input = {
      $imports: {
        vars: 'vars.yaml',
        removeMe: 'foo.yaml'
      },
      $defs: {
        name: new yaml.$include('vars.name'),
        removeMe: ''
      },
      name: new yaml.$include('name')
    };
    const filtered = filter(['name'], input, 'test');
    expect(_.keys(filtered)).to.members(['name', '$defs', '$imports']);
    expect(_.keys(filtered.$imports)).to.members(['vars']);
    expect(_.keys(filtered.$defs)).to.members(['name']);
  });
});
