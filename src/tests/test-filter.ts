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
});
