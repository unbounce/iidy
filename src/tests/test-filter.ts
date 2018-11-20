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
    expect(_.keys(filtered)).to.deep.equal(['two', 'three', '$imports', '$defs']);
    expect(_.keys(filtered.$defs)).to.deep.equal(['b'])
    expect(_.keys(filtered.$imports)).to.deep.equal(['c'])

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
      expect(_.keys(filtered)).to.deep.equal(['two', '$defs']);
      expect(_.keys(filtered.$defs)).to.deep.equal(['c'])
      expect(_.keys(filtered.$defs.c)).to.deep.equal(['d'])
  });
});
