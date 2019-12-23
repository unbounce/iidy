import {expect} from 'chai';
import {stub} from 'sinon';

import * as getReliableTime from '../getReliableTime';

describe("getReliableTime", () => {

  it("works on the happy path", async function() {
    const t = await getReliableTime.getReliableTime();
    expect(t).to.be.instanceof(Date);
  });

  it("works on the bad path and retries", async function() {
    const stubbedGetNetworkTime = stub(getReliableTime,'getNetworkTime').rejects(new Error('mock error'));
    try {
      const t = await getReliableTime.getReliableTime();
      expect(t).to.be.instanceof(Date);
      expect(stubbedGetNetworkTime.callCount).to.equal(2);
    } finally {
      stubbedGetNetworkTime.restore();
    }
  });

})
