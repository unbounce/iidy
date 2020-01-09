import {expect} from 'chai';

import calcElapsedSeconds from '../calcElapsedSeconds';

describe("calcElapsedSeconds", () => {

  it("works on the happy path", () => {
    const t = calcElapsedSeconds(new Date());
    expect(t).to.be.an('number');
    expect(t).to.be.oneOf([0,1]);
  });

})
