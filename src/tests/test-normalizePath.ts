import * as process from 'process';
import * as path from 'path';
import {expect} from 'chai';
import normalizePath from '../normalizePath';

describe('normalizePath', () => {
  it('can handle ~', () => {
    expect(normalizePath('~/blah'))
      .to.equal(path.join(process.env.HOME as string, '/blah'));
  });

  it('can handle ~ and multiple args', () => {
    expect(normalizePath('~/blah', 'foo', 'baz'))
      .to.equal(path.join(process.env.HOME as string, '/blah/foo/baz'));
  });

});
