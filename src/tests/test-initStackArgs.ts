import * as fs from 'fs';
import {expect} from 'chai';
import {stub} from 'sinon'

import * as output from '../output';
import { initStackArgs } from '../initStackArgs';

describe('initStackArgs', async () => {
  it('does not crash and writes to ./stack-args.yaml & ./cfn-template.yaml', async () => {
    const stubbedWriteFile = stub(fs, 'writeFileSync');
    const stubbedWriteLine = stub(output, 'writeLine');
    const stubbedWriteRaw = stub(output, 'writeRaw');

    try {
      await initStackArgs({} as any);
      expect(stubbedWriteFile.calledWith('stack-args.yaml')).to.be.true;
      expect(stubbedWriteFile.calledWith('cfn-template.yaml')).to.be.true;
    } finally {
      stubbedWriteFile.restore();
      stubbedWriteLine.restore();
      stubbedWriteRaw.restore();
    }
  });
});
