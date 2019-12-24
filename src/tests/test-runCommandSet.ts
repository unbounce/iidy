import {expect} from 'chai';
import * as sinon from 'sinon';
import * as output from '../output';
import {runCommandSet} from '../cfn/runCommandSet';

describe('runCommandSet', () => {
  it('returns the commands run and does not barf', async () => {
    const stubbedWriteLine = sinon.stub(output, 'writeLine');
    const commands = ['echo 123 > /dev/null', 'echo abc > /dev/null'];
    const resOutput = runCommandSet(commands, '.');
    try {
      expect(resOutput).to.deep.equal(commands);
    } finally {
      stubbedWriteLine.restore();
    }
  })
});
