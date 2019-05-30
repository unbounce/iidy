import * as aws from 'aws-sdk';
import * as cli from 'cli-color';
import * as _ from 'lodash';
import * as nameGenerator from 'project-name-generator';
import * as querystring from 'querystring';
import * as fs from 'fs';
import * as inquirer from 'inquirer';
import calcElapsedSeconds from '../calcElapsedSeconds';
import {GenericCLIArguments} from '../cli/utils';
import confirmationPrompt from '../confirmationPrompt';
import getCurrentAWSRegion from '../getCurrentAWSRegion';
import {logger} from '../logger';
import mkSpinner from '../spinner';
import {FAILURE, INTERRUPT, SUCCESS} from '../statusCodes';
import timeout from '../timeout';
import {AbstractCloudFormationStackCommand} from './AbstractCloudFormationStackCommand';
import {diffStackTemplates} from './diffStackTemplates';
import {EstimateStackCost} from './estimateStackCost';
import {formatSectionHeading, showFinalComandSummary} from './formatting';
import {loadStackArgs} from './loadStackArgs';
import {showPendingChangesets} from './showPendingChangesets';
import {stackArgsToCreateChangeSetInput} from './stackArgsToX';
import {summarizeStackDefinition} from './summarizeStackDefinition';
import terminalStackStates from './terminalStackStates';
import {CfnOperation, StackArgs} from './types';
import * as tracking from '../tracking';

export async function doesStackExist(StackName: string): Promise<boolean> {
  const cfn = new aws.CloudFormation();
  return await cfn.describeStacks({StackName}).promise().thenReturn(true).catchReturn(false);
}

class CreateStack extends AbstractCloudFormationStackCommand {
  cfnOperation: CfnOperation = 'CREATE_STACK';
  expectedFinalStackStatus = ['CREATE_COMPLETE'];
  showTimesInSummary = false;
  showPreviousEvents = false;

  async _run() {
    return this._runCreate();
  }
}

class UpdateStack extends AbstractCloudFormationStackCommand {
  cfnOperation: CfnOperation = 'UPDATE_STACK';
  expectedFinalStackStatus = ['UPDATE_COMPLETE'];

  async _run() {
    return this._runUpdate();
  }
}

export class CreateChangeSet extends AbstractCloudFormationStackCommand {
  public changeSetName: string;
  public hasChanges: undefined | boolean;

  cfnOperation: CfnOperation = 'CREATE_CHANGESET'
  expectedFinalStackStatus = terminalStackStates
  watchStackEvents = false
  showPreviousEvents = false;

  async _run() {
    // TODO remove argv as an arg here. Too general

    const ChangeSetName = this.argv.changesetName || nameGenerator().dashed; // TODO parameterize
    this.changeSetName = ChangeSetName;
    const createChangeSetInput =
      await stackArgsToCreateChangeSetInput(ChangeSetName, this.stackArgs, this.argsfile, this.environment, this.stackName);
    const StackName = createChangeSetInput.StackName;
    createChangeSetInput.Description = this.argv.description;

    const stackExists = await doesStackExist(StackName);
    createChangeSetInput.ChangeSetType = stackExists ? 'UPDATE' : 'CREATE';

    if (await this._requiresTemplateApproval(createChangeSetInput.TemplateURL)) {
      return this._exitWithTemplateApprovalFailure();
    }
    // TODO check for exception: 'ResourceNotReady: Resource is not in the state changeSetCreateComplete'
    await this.cfn.createChangeSet(createChangeSetInput).promise();
    await this._waitForChangeSetCreateComplete().catch(() => null); // catch for failed changesets
    const changeSet = await this.cfn.describeChangeSet({ChangeSetName, StackName}).promise();

    this.hasChanges = !_.isEmpty(changeSet.Changes);

    if (changeSet.Status === 'FAILED') {
      logger.error(`${changeSet.StatusReason as string} Deleting failed changeset.`);
      await this.cfn.deleteChangeSet({ChangeSetName, StackName}).promise();
      return !this.hasChanges && this.argv.allowEmpty ? SUCCESS : FAILURE;
    }
    console.log();

    console.log('AWS Console URL for full changeset review:',
      cli.blackBright(
        `https://${this.region}.console.aws.amazon.com/cloudformation/home?region=${this.region}#`
        + `/changeset/detail?stackId=${querystring.escape(changeSet.StackId as string)}`
        + `&changeSetId=${querystring.escape(changeSet.ChangeSetId as string)}`));

    await showPendingChangesets(StackName);
    // TODO diff createChangeSetInput.TemplateBody
    if (!stackExists) {
      console.log('Your new stack is now in REVIEW_IN_PROGRESS state. To create the resources run the following \n  ' +
        this.normalizeIidyCLICommand(`exec-changeset --stack-name ${this.stackName} ${this.argsfile} ${ChangeSetName}`));
      console.log();
    }
    showFinalComandSummary(true);
    return SUCCESS;
  }

  async _waitForChangeSetCreateComplete() {
    const StackName = this.stackName;

    const pollInterval = 1;     // seconds
    const startTime = this.startTime;
    const spinner = mkSpinner();

    while (true) {
      const {Status, StatusReason} = await this.cfn.describeChangeSet({ChangeSetName: this.changeSetName, StackName}).promise();
      spinner.stop();
      if (Status === 'CREATE_COMPLETE') {
        break;
      } else if (Status === 'FAILED') {
        throw new Error(`Failed to create changeset: ${StatusReason}`);
      } else {
        spinner.start();
        spinner.text = cli.xterm(240)(
          `${calcElapsedSeconds(startTime)} seconds elapsed.`);
        await timeout(pollInterval * 1000);
      }
    }
  }
}

export async function createOrUpdateChangeSetMain(argv: GenericCLIArguments): Promise<number> {
  const stackArgs = await loadStackArgs(argv);
  const StackName = argv.stackName || stackArgs.StackName;
  const changeSetExists = await doesChangeSetExist(StackName);
  if (changeSetExists) {
    return updateStackMain(argv, stackArgs);
  } else if (argv.changeset) {
    // TODO extract this into a separate createStackMain fn
    // TODO autodetect AWS::Serverless and default to changeset=true
    const changeSetRunner = new CreateChangeSet(argv, stackArgs);
    const createChangesetResult = await changeSetRunner.run();
    if (createChangesetResult > 0) {
      return createChangesetResult;
    } else {
      console.log()
      return await confirmChangesetExec(argv, changeSetRunner, stackArgs);
    }
  } else {
    return new CreateStack(argv, stackArgs).run();
  }
}


class ExecuteChangeSet extends AbstractCloudFormationStackCommand {
  cfnOperation: CfnOperation = 'EXECUTE_CHANGESET'
  expectedFinalStackStatus = ['UPDATE_COMPLETE', 'CREATE_COMPLETE']

  async _run() {
    await this.cfn.executeChangeSet(
      {
        ChangeSetName: this.argv.changesetName,
        ClientRequestToken: this.argv.clientRequestToken,
        StackName: this.stackName
      }).promise();
    return this._watchAndSummarize(this.stackName);
  }
}

const wrapCommandCtor =
  (Ctor: new (argv: GenericCLIArguments, stackArgs: StackArgs) => AbstractCloudFormationStackCommand) =>
    async function(argv: GenericCLIArguments): Promise<number> {
      return new Ctor(argv, await loadStackArgs(argv)).run();
    }

export const createStackMain = wrapCommandCtor(CreateStack);
export const executeChangesetMain = wrapCommandCtor(ExecuteChangeSet);
export const estimateCost = wrapCommandCtor(EstimateStackCost);

export async function ciMain(argv: GenericCLIArguments): Promise<number> {
  const providedOptions = tracking.relevantOptions(argv);
  const extraArgs = argv.changeset ? ['--allow-empty'] : [];
  const command = argv.changeset ? 'create-changeset' : 'update-stack';
  const dirs = tracking.trackedDirectories(process.cwd());

  for (const dir of dirs) {
    let stacks = tracking.trackedStacks(dir, process.argv[1], command, extraArgs);
    if (_.some(providedOptions)) {
      stacks = tracking.filterOnOptions(stacks, providedOptions);
    }

    const success = tracking.updateExistingStacks(stacks);
    if(!success) {
      return FAILURE;
    }
  }

  return SUCCESS;
}

export async function updateExistingMain(argv: GenericCLIArguments): Promise<number> {
  const providedOptions = tracking.relevantOptions(argv);
  const extraArgs = argv.changeset ? ['--changeset'] : [];
  const dir = process.cwd();
  let stacks = tracking.trackedStacks(dir, process.argv[1], 'update-stack', extraArgs);

  if(_.isEmpty(stacks)) {
    logger.info(`No tracked stacks in ${dir}`);
    return SUCCESS;
  }

  if(argv.all) {
    // Include all stacks
    // stacks = stacks;
  } else if (_.some(providedOptions)) {
    stacks = tracking.filterOnOptions(stacks, providedOptions);
    if(_.isEmpty(stacks)) {
      const cliArgs = tracking.unparseArgv(providedOptions).join(' ');
      logger.info(`No tracked stacks in ${dir} matching ${cliArgs}`);
      return SUCCESS;
    }
  } else {
    // If no options are provided (eg. --region ... or --environment ...), prompt the user for input
    const {selected} = await inquirer.prompt<{selected: typeof stacks}>({
      name: 'selected',
      type: 'checkbox',
      default: [],
      choices: _.map(stacks, (stack) => ({ name: stack.displayCommand, value: stack })),
      message: 'Select stacks to update'
    });

    if(_.isEmpty(selected)) {
      logger.info(`No stacks selected`);
      return SUCCESS;
    } else {
      stacks = selected;
    }
  }

  return tracking.updateExistingStacks(stacks) ? SUCCESS : FAILURE;
}

export async function createOrUpdateStackMain(argv: GenericCLIArguments): Promise<number> {
  const stackArgs = await loadStackArgs(argv);
  const StackName = argv.stackName || stackArgs.StackName;
  const stackExists = await doesStackExist(StackName);
  if (stackExists) {
    return updateStackMain(argv, stackArgs);
  } else if (argv.changeset) {
    // TODO extract this into a separate createStackMain fn
    // TODO autodetect AWS::Serverless and default to changeset=true
    const changeSetRunner = new CreateChangeSet(argv, stackArgs);
    const createChangesetResult = await changeSetRunner.run();
    if (createChangesetResult > 0) {
      return createChangesetResult;
    } else {
      console.log()
      return await confirmChangesetExec(argv, changeSetRunner, stackArgs);
    }
  } else {
    return new CreateStack(argv, stackArgs).run();
  }
}

async function confirmChangesetExec(argv: GenericCLIArguments, changeSetRunner: CreateChangeSet, stackArgs: StackArgs): Promise<number> {
  let confirmed: boolean;
  if (argv.yes) {
    confirmed = true;
  } else {
    confirmed = await confirmationPrompt('Do you want to execute this changeset now?');
  }
  if (confirmed) {
    argv.changesetName = changeSetRunner.changeSetName;
    return new ExecuteChangeSet(argv, stackArgs).run();
  } else {
    console.log(
      `You can do so later using\n  `
      + changeSetRunner.normalizeIidyCLICommand(
        `exec-changeset -s ${changeSetRunner.stackName} ${changeSetRunner.argsfile} ${changeSetRunner.changeSetName}`));
    return INTERRUPT;
  }
}

export async function updateStackMain(argv: GenericCLIArguments, stackArgs?: StackArgs): Promise<number> {
  stackArgs = stackArgs || await loadStackArgs(argv);
  if (argv.changeset) {
    const region = getCurrentAWSRegion();
    const StackName = argv.stackName || stackArgs.StackName;
    await summarizeStackDefinition(StackName, region);
    const changeSetRunner = new CreateChangeSet(argv, stackArgs);

    if (argv.diff) {
      console.log()
      console.log(formatSectionHeading('Stack Template Diff:'))
      await diffStackTemplates(changeSetRunner.stackName, stackArgs, argv.argsfile, argv.environment!);
      console.log()
    }

    const createChangesetResult = await changeSetRunner.run();
    if (createChangesetResult > 0) {
      if (changeSetRunner.hasChanges) {
        return createChangesetResult;
      } else {
        logger.info('No changes to apply');
        return SUCCESS;
      }
    }
    console.log()
    return await confirmChangesetExec(argv, changeSetRunner, stackArgs);
  } else {
    return new UpdateStack(argv, stackArgs).run();
  }
};
