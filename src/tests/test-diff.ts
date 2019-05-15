import {expect} from 'chai';
import {diff} from "../diff";

describe('diff', () => {
  it('works and doesn\'t explode', () => {
    expect(diff('a', 'a')).to.equal(true);
    expect(diff('a', 'b')).to.equal(false);
  });
});
