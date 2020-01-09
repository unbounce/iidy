import * as fs from 'fs';
import * as process from 'process';
import * as yargs from 'yargs';
import {expect} from 'chai';
import * as awsMock from 'aws-sdk-mock';
import * as _aws from 'aws-sdk';
import * as sinon from 'sinon';


import * as output from '../output';
import {listStacks, listStacksMain} from '../cfn/listStacks';
import {describeStackMain} from '../cfn/describeStack';
import * as mockStacks from './fixtures/mock-stacks.json'
import * as mockStackEvents from './fixtures/mock-stack-events.json'

// import {getStackDescription} from '../cfn/getStackDescription';
import {watchStackMain} from '../cfn/watchStack';
import {getKMSAliasForParameter} from '../params';
import inquirer = require('inquirer');
import {buildParamCommands, lazyParamCommands} from '../params/cli';
import {INTERRUPT} from '../statusCodes';
import {buildApprovalCommands, lazyApprovalCommands} from '../cfn/approval/cli';
import {Handler} from '../cli/types';
import {getImportMain} from '../getImport';
import {renderMain, RenderArguments, isStackArgsFile} from '../render';
import * as render from '../render';

mockStackEvents.StackEvents.forEach(ev => {
  (ev as any).Timestamp = Date.parse(ev.Timestamp)
})

type CommandHandlers = {[Key: string]: Handler};
const promisifyCommands = (commands: CommandHandlers, resolve: any, reject: any) => {
  const wrappedCommands: CommandHandlers = {};
  for (const [key, handler] of Object.entries(commands)) {
    wrappedCommands[key] = (args) => handler(args)
      .then(res => {
        resolve(res);
        return res;
      }).catch(err => {
        reject(err);
        throw err;
      });
  }
  return wrappedCommands;
};

export type CLIBuilder = (args: yargs.Argv, commands: any // CommandHandlers
) => yargs.Argv;

const promisifyCLI = (cliBuilder: CLIBuilder, commands: CommandHandlers, argstring: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    const wrappedCommands = promisifyCommands(commands, resolve, reject);
    cliBuilder(yargs, wrappedCommands).parse(argstring);
  });
}

const mockResources = {
  "StackResources": [
    {
      "StackId": "arn:aws:cloudformation:us-west-2:894790724410:stack/iidy-demo-heartbreaking-company/e19428d0-78c3-11e9-9e0b-02c5b84a8036",
      "ResourceStatus": "CREATE_COMPLETE",
      "ResourceType": "AWS::SNS::Topic",
      "Timestamp": "2019-05-17T16:50:47.308Z",
      "StackName": "iidy-demo-heartbreaking-company",
      "PhysicalResourceId": "arn:aws:sns:us-west-2:894790724410:iidy-demo-heartbreaking-company-HelloWorld-138QXIGFY3TUC",
      "LogicalResourceId": "HelloWorld"
    }
  ]
};

describe('cfn operations with aws-sdk-mock', async function() {
  const originalRegion = process.env.AWS_REGION;

  let stubbedExit: sinon.SinonStub;
  let stubbedPrompt: sinon.SinonStub;
  let stubbedWriteLine: sinon.SinonStub;
  let stubbedWriteRaw: sinon.SinonStub;

  const runApprovalCLI = async (argstring: string, expectedExitCode: number = 0) => {
    const result = await promisifyCLI(buildApprovalCommands, lazyApprovalCommands as any, argstring);
    expect(result, `iidy template-approval ${argstring} => exits with ${expectedExitCode}`).to.equal(expectedExitCode)
    expect(stubbedExit.callCount).to.equal(1);
    expect(stubbedExit.getCall(0).args[0], `iidy template-approval ${argstring} => exits with ${expectedExitCode}`)
      .to.equal(expectedExitCode);
  }

  const runParamsCLI = async (argstring: string, expectedExitCode: number = 0) => {
    const result = await promisifyCLI(buildParamCommands, lazyParamCommands as any, argstring);
    expect(result, `iidy params ${argstring} => exits with ${expectedExitCode}`).to.equal(expectedExitCode)
    //expect(stubbedExit.callCount).to.equal(1);
    expect(stubbedExit.getCall(0).args[0], `iidy params ${argstring} => exits with ${expectedExitCode}`)
      .to.equal(expectedExitCode);
  }

  beforeEach(() => {
    stubbedWriteLine = sinon.stub(output, 'writeLine');
    stubbedWriteRaw = sinon.stub(output, 'writeRaw');

    stubbedExit = sinon.stub(process, 'exit');

    //awsMock.setSDKInstance(aws);
    process.env.AWS_REGION = 'us-west-2';
    process.env.AWS_MOCK = 'true'; // TODO replace this approach with a mock of configureAws itself
    awsMock.mock('SSM', 'getParametersByPath', () => Promise.resolve({})); // called from initStackArgs

    awsMock.mock('CloudFormation', 'describeStacks', () => Promise.resolve({Stacks: mockStacks.Stacks.slice(0, 1)}));
    awsMock.mock('CloudFormation', 'getStackPolicy', () => Promise.resolve({}));
    awsMock.mock('CloudFormation', 'describeStackEvents', () => Promise.resolve(mockStackEvents));
    awsMock.mock('CloudFormation', 'describeStackResources', () => Promise.resolve(mockResources));
    awsMock.mock('CloudFormation', 'listExports', () => Promise.resolve({}));
    awsMock.mock('CloudFormation', 'listChangeSets', () => Promise.resolve({}));

  });

  afterEach(() => {
    stubbedWriteLine.restore();
    stubbedWriteRaw.restore();
    stubbedExit.restore();
    if (stubbedPrompt) {
      stubbedPrompt.restore();
    }

    process.env.AWS_REGION = originalRegion;
    delete process.env.AWS_MOCK;
    awsMock.restore();
  });

  it('describeStackMain', async () => {
    await describeStackMain({
      $0: 'iidy', _: [],
      environment: "development",
      stackname: 'iidy-demo-heartbreaking-company'
    });
  });

  it('listStacks', async () => {
    awsMock.remock('CloudFormation', 'describeStacks', () => Promise.resolve({Stacks: mockStacks.Stacks}));
    await listStacks();
    await listStacksMain({$0: 'iidy', _: [], environment: "development"});

  });

  it('watchStackMain', async function() {
    this.timeout(8000);
    await watchStackMain({
      $0: 'iidy', _: [], environment: "development",
      stackname: 'iidy-demo-heartbreaking-company',
      inactivityTimeout: -1
    });
  });

  describe('template-approval', async function() {
    describe('request', function() {
      beforeEach(() => {
        awsMock.mock('S3', 'getSignedUrl', () => Promise.resolve('https://blah-approved-cfn-templates-/project/4775da03c36b9f1fb2cc22380c3bbcee.yaml.pending'));
        awsMock.mock('SSM', 'getParametersByPath', () => Promise.resolve({}));
      });

      it('already approved', async () => {
        awsMock.mock('S3', 'headObject', () => Promise.resolve({}));
        await runApprovalCLI('request src/tests/fixtures/stack-args.for-approval.yaml', 0);
      });

      it('NOT already approved', async () => {
        awsMock.mock('S3', 'headObject', () => Promise.reject({code: "NotFound"}));
        awsMock.mock('S3', 'putObject', () => Promise.resolve({}));
        await runApprovalCLI('request --lint-template=false src/tests/fixtures/stack-args.for-approval.yaml', 0);
      });

    });

    //awsMock.mock('S3', 'getObject', () => Promise.resolve({}));

    describe('review', async function() {
      beforeEach(() => {
        awsMock.mock('S3', 'putObject', () => Promise.resolve({}));
      });

      it('already approved', async () => {
        awsMock.mock('S3', 'headObject', () => Promise.resolve({}));
        await runApprovalCLI('review s3://blah-approved-cfn-templates-/project/4775da03c36b9f1fb2cc22380c3bbcee.yaml.pending', 0);
      });

      it('NOT already approved', async () => {
        awsMock.mock('S3', 'headObject', () => Promise.reject({code: "NotFound"}));
        awsMock.mock('S3', 'getObject', () => Promise.resolve({Body: "hi"}));
        awsMock.mock('S3', 'putObject', () => Promise.resolve({}));
        awsMock.mock('S3', 'deleteObject', () => Promise.resolve({}));
        stubbedPrompt = sinon.stub(inquirer, 'prompt').returns({confirmed: true} as any);
        await runApprovalCLI('review s3://blah-approved-cfn-templates-/project/4775da03c36b9f1fb2cc22380c3bbcee.yaml.pending', 0);
      });

    });
  });

  describe('params', async function() {
    beforeEach(() => {
      awsMock.mock('SSM', 'getParameter', () => Promise.resolve({Parameter: {Value: 'foo', Name: '/foo'}}));
      awsMock.mock('SSM', 'getParametersByPath', () => Promise.resolve(
        {
          Parameters: [{Value: 'foo', Name: '/foo'},
          {Value: 'bar', Name: '/bar'},
          {Value: 'foobar', Name: '/foo/bar'},
          ]
        }));
      awsMock.mock('SSM', 'getParameterHistory', () => Promise.resolve(
        {Parameters: [{Value: 'old', Name: '/foo'}, {Value: 'new', Name: '/foo'}]}));
      awsMock.mock('SSM', 'listTagsForResource', () => Promise.resolve({}));
      awsMock.mock('SSM', 'putParameter', () => Promise.resolve({}));
      awsMock.mock('SSM', 'deleteParameter', () => Promise.resolve({}));
      awsMock.mock('SSM', 'addTagsToResource', () => Promise.resolve({}));

      awsMock.mock('KMS', 'listAliases', () => Promise.resolve([]));
    });

    this.timeout(4000);

    it('getParam', async function() {
      await runParamsCLI('get /foo');
      await runParamsCLI('get /foo --format json');
      await runParamsCLI('get /foo --format yaml');
    });

    it('getParamsByPath', async function() {
      await runParamsCLI('get-by-path /foo');
      await runParamsCLI('get-by-path /foo --format json');
      await runParamsCLI('get-by-path /foo --format yaml');
    });

    it('getParamHistory', async function() {
      await runParamsCLI('get-history /foo');
      await runParamsCLI('get-history /foo --format json');
      await runParamsCLI('get-history /foo --format yaml');
    });

    it('getKMSAliasForParameter', async function() {
      await getKMSAliasForParameter('/foo');
    });

    it('setParam', async function() {
      await runParamsCLI('set /foo foo');
      await runParamsCLI('set /foo foo --message "a test"');
      await runParamsCLI('set /foo foo --with-approval');
    });

    it('reviewParam approved', async function() {
      stubbedPrompt = sinon.stub(inquirer, 'prompt').returns({confirmed: true} as any);
      await runParamsCLI('review /foo');
    });

    it('reviewParam rejected', async function() {
      stubbedPrompt = sinon.stub(inquirer, 'prompt').returns({confirmed: false} as any);
      await runParamsCLI('review /foo', INTERRUPT);
    });

  });

  describe('getImport', () => {
    it('works on local file imports', async () => {
      await getImportMain({import: 'package.json'} as any);
      await getImportMain({import: 'package.json', format: 'yaml'} as any);
      await getImportMain({import: 'package.json', query: 'version'} as any);
    })
  });

  describe('render', () => {
    let stubbedWriteToStream: sinon.SinonStub;
    beforeEach(() => {
      stubbedWriteToStream = sinon.stub(render, '_writeToStream');
    });

    afterEach(() => {
      stubbedWriteToStream.restore();
    });
    const baseArgs = {
      _: [],
      '$0': 'iidy',
      environment: 'test',
      template: 'src/tests/fixtures/render/cfn-template.minimal.yaml',
      outfile: '/dev/null',
      overwrite: true
    } as RenderArguments;

    it('works on local cfn template file', async () => {
      expect(await renderMain(baseArgs)).to.equal(0);
    });

    it('works on local cfn template file with --query', async () => {
      const capturedOutput: string[] = [];
      expect(await renderMain({...baseArgs, query: 'Parameters.Name.Type'}, (output) => capturedOutput.push(output))).to.equal(0);
      expect(capturedOutput[0]).to.equal('"String"');
    });

    it('works on local directories', async () => {
      expect(await renderMain({...baseArgs, template: 'src/tests/fixtures/render'})).to.equal(0);
    });

    it('works on local stack-args file', async () => {
      expect(isStackArgsFile('stack-args.yaml', {})).to.be.true;
      expect(isStackArgsFile('stack-args.yml', {})).to.be.true;
      expect(isStackArgsFile('blah.yaml', {Template: 'cfn.yaml', StackName: 'test'})).to.be.true;
      expect(isStackArgsFile('blah.yaml', {Template: 'cfn.yaml', Parameters: {}})).to.be.true;
      expect(isStackArgsFile('blah.yaml', {Template: 'cfn.yaml', Tags: {}})).to.be.true;
      // TODO assert that it handled it correctly
      const result = await renderMain({
        ...baseArgs,
        template: 'src/tests/fixtures/render/stack-args.minimal.yaml',
      });
      expect(result).to.equal(0);
    })

    it('throws an error if outfile exists and not --overwrite', async () => {
      expect((await renderMain({...baseArgs, overwrite: false}).catch(e => e)).message
      ).to.include('Use --overwrite to proceed');
    });

    it('works with outfile=/dev/stdout', async () => {
      expect(await renderMain({...baseArgs, outfile: '/dev/stdout'})).to.equal(0);
      expect(await renderMain({...baseArgs, outfile: 'stdout'})).to.equal(0);
    });

    it('works with outfile=/dev/stderr', async () => {
      expect(await renderMain({...baseArgs, outfile: '/dev/stderr'})).to.equal(0);
      expect(await renderMain({...baseArgs, outfile: 'stderr'})).to.equal(0);
    });

    it('works with template=stdin', async () => {
      const stubbedReadFileSync = sinon.stub(fs, 'readFileSync').returns(Buffer.from("{}"));
      const capturedOutput: string[] = [];
      try {
        expect(await renderMain(
          {...baseArgs, template: true},
          (output) => capturedOutput.push(output))
        ).to.equal(0);
      } finally {
        stubbedReadFileSync.restore();
      }
      expect(capturedOutput[0]).to.equal('{}');
    });

  });

});
