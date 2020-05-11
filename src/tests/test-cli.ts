import {expect} from 'chai';

import {buildArgs, lazyLoad} from "../main";
import {implementations} from "../cli/command-implementations";
import {} from "../cfn/approval/cli";
import {} from "../cfn/approval/index";

describe('cli', () => {
  it('--help displays help', async function () {
    this.timeout(3000); // timesout in test-watch mode sometimes

    const parser = buildArgs().exitProcess(false);
    const output = await new Promise((resolve) => {
      parser.parse("--help", (_err: {}, _argv: {}, data: string) => {
        resolve(data);
      })
    });
    expect(output).to.contain("CloudFormation with Confidence");
  });

  it('lazy loaded implementations are loadable', () => {
    expect(typeof lazyLoad('createStackMain')).to.equal('function');
    expect(implementations.createStackMain).to.equal(
      require('../cli/command-implementations').implementations.createStackMain);
  });

});
