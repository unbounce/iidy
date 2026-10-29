import {expect} from 'chai';
import {runCommandSet} from '../cfn/runCommandSet';

describe('runCommandSet', () => {
  it('returns the commands run and does not barf', async () => {
    const commands = ['echo 123', 'echo abc'];
    const output = runCommandSet(commands, '.');
    expect(output).to.deep.equal(commands);
  })

  it('runs commands with PKG_EXECPATH defined and empty', async () => {
    // a packaged iidy must not hand its own PKG_EXECPATH to nested iidy calls
    const commands = ['[ "${PKG_EXECPATH+set}" = set ] && [ -z "$PKG_EXECPATH" ]'];
    expect(() => runCommandSet(commands, '.')).to.not.throw();
  })
});
