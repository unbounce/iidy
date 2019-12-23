import {expect} from 'chai';

import {demoMain} from '../demo';

describe("iidy demo", async () => {
  it("works on valid scripts", async () => {
    const result = await demoMain(
      {demoscript: './src/tests/fixtures/demo/simple.yaml', timescaling: 0 } as any);
    expect(result).to.equal(0);
  });

  it("works on files in subdirs", async () => {
    const result = await demoMain(
      {demoscript: './src/tests/fixtures/demo/good-files-in-subdirs.yaml', timescaling: 0 } as any);
    expect(result).to.equal(0);
  });

  it("correctly bails on scripts with invalid commands", async () => {
    const result = await demoMain(
      {demoscript: './src/tests/fixtures/demo/bad-command-type.yaml', timescaling: 0 } as any)
      .catch(e => e);
    expect(result).to.be.instanceof(Error);
    expect(result.message).to.equal('Invalid demo command: 123');
  });

  it("correctly bails on scripts with failing commands", async () => {
    const result = await demoMain(
      {demoscript: './src/tests/fixtures/demo/failing-command.yaml', timescaling: 0 } as any)
      .catch(e => e);
    expect(result).to.be.instanceof(Error);
    expect(result.message).to.equal('command failed: false. exitcode=1');
  });

  it("correctly bails on files with absolute paths", async () => {
    const result = await demoMain(
      {demoscript: './src/tests/fixtures/demo/bad-absolute-file-path.yaml', timescaling: 0 } as any)
      .catch(e => e);
    expect(result).to.be.instanceof(Error);
    expect(result.message).to.equal('Illegal path /absolute.txt. Must be relative.');
  });

});
