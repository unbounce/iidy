import {expect} from 'chai';
import {runCommandSet} from '../cfn/runCommandSet';

describe('runCommandSet', () => {
  it('returns the commands run and does not barf', async () => {
    const commands = ['echo 123', 'echo abc'];
    const output = runCommandSet(commands, '.');
    expect(output).to.deep.equal(commands);
  })
});
