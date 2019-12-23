import {expect} from 'chai';
import {stub, SinonStub} from 'sinon';
import * as _ from 'lodash';

import {buildArgs, lazyLoad} from "../main";
import {implementations} from "../cli/command-implemntations";
import {} from "../cfn/approval/cli";
import {} from "../cfn/approval/index";
import {wrapCommandHandler, GenericCLIArguments} from '../cli/utils';
import timeout from '../timeout';
import {logger, getLogLevel, setLogLevel} from '../logger';

describe('cli', () => {
  it('--help displays help', async function() {
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
      require('../cli/command-implemntations').implementations.createStackMain);
  });

  describe('wrapCommandHandler', () => {
    const goodWrapped = wrapCommandHandler(async () => 0);
    const badWrapped = wrapCommandHandler(async () => 1);
    const errorMsg = 'Exception-Test';
    const errorWrapped = wrapCommandHandler(async () => {
      throw new Error(errorMsg);
    });
    const errWithNoMsg = new Error();
    delete errWithNoMsg.message;
    const errorNoMessageWrapped = wrapCommandHandler(async () => {
      throw errWithNoMsg;
    });

    let stubbedExit: SinonStub;
    let stubbedLogError: SinonStub;
    let stubbedConsoleError: SinonStub;
    const originalLogLevel = getLogLevel();
    const originalDebugEnvvar = process.env.DEBUG;

    beforeEach(function() {
      stubbedExit = stub(process, 'exit');
      stubbedLogError = stub(logger, 'error');
      stubbedConsoleError = stub(console, 'error');
    });

    afterEach(function() {
      stubbedExit.restore();
      stubbedLogError.restore();
      stubbedConsoleError.restore();
      setLogLevel(originalLogLevel);
      if (_.isUndefined(originalDebugEnvvar)) {
        delete process.env.DEBUG;
      } else {
        process.env.DEBUG = originalDebugEnvvar;
      }

    });

    it('calls process.exit(0) on success', async () => {
      goodWrapped({} as GenericCLIArguments);
      await timeout(1);
      expect(stubbedExit.calledWith(0)).to.be.true;
    });

    it('calls process.exit(1) on failure', async () => {
      badWrapped({} as GenericCLIArguments);
      await timeout(1);
      expect(stubbedExit.calledWith(1)).to.be.true;
    });

    it('exceptions are caught, logged, and process.exit(1) is called', async () => {
      errorWrapped({} as GenericCLIArguments);
      await timeout(1);
      expect(stubbedExit.calledWith(1)).to.be.true;
      expect(stubbedLogError.calledWith(errorMsg)).to.be.true;
      expect(stubbedLogError.callCount).to.equal(1);
      expect(stubbedConsoleError.callCount).to.equal(0);
    });

    it('exceptions with no message are logged in full', async () => {
      errorNoMessageWrapped({} as GenericCLIArguments);
      await timeout(1);
      expect(stubbedExit.calledWith(1)).to.be.true;
      expect(stubbedLogError.callCount).to.equal(1);
      expect(stubbedLogError.calledWith("unhandled exception", errWithNoMsg)).to.be.true;
      expect(stubbedConsoleError.callCount).to.equal(0);
    });

    describe('when --debug or --log-full-error, exceptions are caught, logged, and console.error() in full ', async () => {
      it('--debug', async () => {
        errorWrapped({debug: true} as GenericCLIArguments);
        await timeout(1);
        expect(stubbedExit.calledWith(1)).to.be.true;
        expect(stubbedLogError.callCount).to.equal(1);
        expect(stubbedConsoleError.callCount).to.equal(1);
      });
      it('--log-full-error', async () => {
        errorWrapped({logFullError: true} as GenericCLIArguments);
        await timeout(1);
        expect(stubbedExit.calledWith(1)).to.be.true;
        expect(stubbedLogError.callCount).to.equal(1);
        expect(stubbedConsoleError.callCount).to.equal(1);
      });
    });

    it('args.debug sets env.DEBUG and log level', async () => {
      goodWrapped({debug: true} as GenericCLIArguments);
      await timeout(1);
      expect(stubbedExit.calledWith(0)).to.be.true;
      expect(process.env.DEBUG).to.be.equal('true');
      expect(getLogLevel()).to.be.equal('debug');
    });

  });

});
