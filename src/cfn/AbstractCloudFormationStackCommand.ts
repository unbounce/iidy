import * as aws from 'aws-sdk';
import * as cli from 'cli-color';
import * as _ from 'lodash';
import * as pathmod from 'path';
import * as request from 'request-promise-native';
import {AWSRegion} from '../aws-regions';
import {GenericCLIArguments} from '../cli/utils';
import def from '../default';
import getCurrentAWSRegion from '../getCurrentAWSRegion';
import {logger} from '../logger';
import {FAILURE, INTERRUPT, SUCCESS} from '../statusCodes';
import {formatSectionHeading, prettyFormatSmallMap, printSectionEntry, showFinalComandSummary} from './formatting';
import {getAllStackEvents} from './getAllStackEvents';
import getReliableStartTime from './getReliableStartTime';
import {getStackDescription} from './getStackDescription';
import {loadCFNStackPolicy} from "./loadCFNStackPolicy";
import {showStackEvents} from './showStackEvents';
import {stackArgsToCreateStackInput, stackArgsToUpdateStackInput} from "./stackArgsToX";
import {summarizeStackContents} from './summarizeStackContents';
import {summarizeStackDefinition} from './summarizeStackDefinition';
import {CfnOperation, StackArgs} from './types';
import {watchStack} from './watchStack';

export async function isHttpTemplateAccessible(location?: string) {
  if (location) {
    try {
      await request.get(location);
      return true;
    } catch (e) {
      return false;
    }
  } else {
    return false;
  }
}

export abstract class AbstractCloudFormationStackCommand {
  public region: AWSRegion;
  readonly profile?: string;
  readonly assumeRoleArn?: string;
  readonly stackName: string;
  readonly argsfile: string;
  readonly environment: string;
  protected cfnOperation: CfnOperation;
  protected startTime: Date;
  protected cfn: aws.CloudFormation;
  protected expectedFinalStackStatus: string[];
  protected showTimesInSummary: boolean = true;
  protected showPreviousEvents: boolean = true;
  protected previousStackEventsPromise: Promise<aws.CloudFormation.StackEvents>;
  protected watchStackEvents: boolean = true;

  constructor(readonly argv: GenericCLIArguments, readonly stackArgs: StackArgs) {
    // region, profile, and assumeRoleArn are the only used for cli output here
    // configureAWS is called by loadStackArgs prior to this constructor
    // TODO We should cleanup / dry-up the resolution rules for these.
    this.region = def(getCurrentAWSRegion(), this.argv.region || this.stackArgs.Region);
    this.profile = ( // the resolved profile
      this.argv.profile || this.stackArgs.Profile
      || process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE); // tslint:disable-line
    this.assumeRoleArn = this.argv.assumeRoleArn || this.stackArgs.AssumeRoleARN; // tslint:disable-line
    this.stackName = this.argv.stackName || this.stackArgs.StackName; // tslint:disable-line
    this.argsfile = argv.argsfile;
    this.environment = argv.environment;
  }

  async _setup() {
    this.cfn = new aws.CloudFormation();
    if (this.showPreviousEvents) {
      this.previousStackEventsPromise = getAllStackEvents(this.stackName);
    }
  }

  async _updateStackTerminationPolicy() {
    if (_.isBoolean(this.stackArgs.EnableTerminationProtection)) {
      const cfn = new aws.CloudFormation();
      return cfn.updateTerminationProtection({
        StackName: this.stackName,
        EnableTerminationProtection: this.stackArgs.EnableTerminationProtection
      }).promise();
    }
  }

  async _showCommandSummary() {
    const sts = new aws.STS();
    const iamIdentPromise = sts.getCallerIdentity().promise();
    const roleARN = this.stackArgs.ServiceRoleARN || this.stackArgs.RoleARN;
    console.log(); // blank line
    console.log(formatSectionHeading('Command Metadata:'));
    printSectionEntry('CFN Operation:', cli.magenta(this.cfnOperation));
    printSectionEntry('iidy Environment:', cli.magenta(this.environment));
    printSectionEntry('Region:', cli.magenta(this.region));
    if (!_.isEmpty(this.profile)) {
      printSectionEntry('Profile:', cli.magenta(this.profile));
    }
    printSectionEntry('CLI Arguments:', cli.blackBright(prettyFormatSmallMap(_.pick(this.argv, ['region', 'profile', 'argsfile']) as any)));
    printSectionEntry('IAM Service Role:', cli.blackBright(def('None', roleARN)));
    const iamIdent = await iamIdentPromise;
    printSectionEntry('Current IAM Principal:', cli.blackBright(iamIdent.Arn));
    printSectionEntry('iidy Version:', cli.blackBright(require('../../package.json').version));
    console.log();
  }

  async run(): Promise<number> {
    await this._setup();
    await this._showCommandSummary();
    this.startTime = await getReliableStartTime();
    return this._run();
  }

  async _watchAndSummarize(stackId: string): Promise<number> {
    // Show user all the meta data and stack properties
    // TODO previous related stack, long-lived dependency stack, etc.
    // we use StackId below rather than StackName to be resilient to deletions
    const stackPromise = getStackDescription(stackId);
    await summarizeStackDefinition(stackId, this.region, this.showTimesInSummary, stackPromise);
    if (this.showPreviousEvents) {
      console.log();
      console.log(formatSectionHeading('Previous Stack Events (max 10):'));
      await showStackEvents(stackId, 10, this.previousStackEventsPromise);
    }
    console.log();
    if (this.watchStackEvents) {
      await watchStack(stackId, this.startTime);
    }
    console.log();
    const stack = await summarizeStackContents(stackId);
    return showFinalComandSummary(_.includes(this.expectedFinalStackStatus, stack.StackStatus));
  }

  async _run(): Promise<number> {
    throw new Error('Not implemented');
  }

  async _runCreate() {
    if (_.isEmpty(this.stackArgs.Template)) {
      throw new Error('For create-stack you must provide at Template: parameter in your argsfile');
    }

    try {
      const createStackInput = await stackArgsToCreateStackInput(this.stackArgs, this.argsfile, this.environment, this.stackName);
      if (await this._requiresTemplateApproval(createStackInput.TemplateURL)) {
        return this._exitWithTemplateApprovalFailure();
      }
      const createStackOutput = await this.cfn.createStack(createStackInput).promise();
      await this._updateStackTerminationPolicy();
      return this._watchAndSummarize(createStackOutput.StackId as string);
    } catch (e) {
      if (e.message === 'CreateStack cannot be used with templates containing Transforms.') {
        logger.error(`Your stack template contains an AWS:: Transform so you need to use 'iidy create-or-update ${cli.red('--changeset')}'`);
        return INTERRUPT;
      } else {
        throw e;
      }
    }
  }

  async _runUpdate() {
    try {
      let updateStackInput = await stackArgsToUpdateStackInput(this.stackArgs, this.argsfile, this.environment, this.stackName);
      if (await this._requiresTemplateApproval(updateStackInput.TemplateURL)) {
        return this._exitWithTemplateApprovalFailure();
      }
      if (this.argv.stackPolicyDuringUpdate) {
        const {
          StackPolicyBody: StackPolicyDuringUpdateBody,
          StackPolicyURL: StackPolicyDuringUpdateURL
        } = await loadCFNStackPolicy(this.argv.stackPolicyDuringUpdate as string, pathmod.join(process.cwd(), 'dummyfile'));
        updateStackInput = _.merge({StackPolicyDuringUpdateBody, StackPolicyDuringUpdateURL}, updateStackInput);
      }
      await this._updateStackTerminationPolicy();
      // TODO consider conditionally calling setStackPolicy if the policy has changed
      const updateStackOutput = await this.cfn.updateStack(updateStackInput).promise();
      return this._watchAndSummarize(updateStackOutput.StackId as string);
    } catch (e) {
      if (e.message === 'No updates are to be performed.') {
        logger.info('No changes detected so no stack update needed.');
        return SUCCESS;
      } else if (e.message === 'UpdateStack cannot be used with templates containing Transforms.') {
        const command = this.normalizeIidyCLICommand(`update-stack ${cli.red('--changeset')}'`);
        logger.error(`Your stack template contains an AWS:: Transform so you need to use '${command}'`);
        return INTERRUPT;
      } else {
        throw e;
      }
    }
  }

  async _requiresTemplateApproval(TemplateURL?: string): Promise<boolean> {
    return !!(this.stackArgs.ApprovedTemplateLocation && !await isHttpTemplateAccessible(TemplateURL));
  }

  _exitWithTemplateApprovalFailure(): number {
    logger.error('Template version has not been approved or the current IAM principal does not have permission to access it. Run:');
    logger.error(`  iidy template-approval request ${this.argsfile}`);
    logger.error('to begin the approval process.');
    return FAILURE;
  }

  normalizeIidyCLICommand(command: string): string {
    let cliArgs = `--region ${this.region}`;
    if (this.profile) {
      cliArgs += ` --profile ${this.profile}`;
    }
    return `iidy ${cliArgs} ${command}`;
  }
}
