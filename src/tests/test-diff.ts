import {expect} from 'chai';
import * as sinon from 'sinon';

import * as child_process from 'child_process';

import * as output from '../output';
import {diff} from "../diff";

describe('diff', () => {
  it('works and doesn\'t explode', () => {
    const stubbedWriteLine = sinon.stub(output, 'writeLine');
    let stubbedSpawnSync = sinon.stub(child_process, 'spawnSync').returns({status: 0} as any);
    try {
      expect(diff('a', 'a')).to.equal(true);
      stubbedSpawnSync.restore();
      stubbedSpawnSync = sinon.stub(child_process, 'spawnSync').returns({status: 1} as any);
      expect(diff('a', 'b')).to.equal(false);
    } finally {
      stubbedWriteLine.restore();
      stubbedSpawnSync.restore();
    }
  });
});
