import * as aws from 'aws-sdk';
import * as cli from 'cli-color';
import * as _ from 'lodash';
import {sprintf} from 'sprintf-js';
import calcElapsedSeconds from '../calcElapsedSeconds';
import {GenericCLIArguments} from '../cli/utils';
import getCurrentAWSRegion from '../getCurrentAWSRegion';
import mkSpinner from '../spinner';
import {SUCCESS} from '../statusCodes';
import timeout from '../timeout';
import * as yaml from '../yaml';
import {formatLogicalId, formatSectionHeading, calcPadding} from './formatting';
import getReliableStartTime from './getReliableStartTime';
import {getStackDescription} from './getStackDescription';
import {getStackNameFromArgsAndConfigureAWS} from "./getStackNameFromArgsAndConfigureAWS";
import {summarizeStackDefinition} from "./summarizeStackDefinition";


async function getAllStackResourceDrifts(StackName: string) {
  const cfn = new aws.CloudFormation();
  let res = await cfn.describeStackResourceDrifts({StackName}).promise();
  let drifts = res.StackResourceDrifts
  while (!_.isUndefined(res.NextToken)) {
    res = await cfn.describeStackResourceDrifts({StackName, NextToken: res.NextToken}).promise();
    drifts = drifts.concat(res.StackResourceDrifts);
  }
  return drifts.filter(d => d.StackResourceDriftStatus != 'IN_SYNC');
}

export async function updateStackDriftData(stack: aws.CloudFormation.Stack, cachePeriodSeconds: number = 60*5) {
  const cfn = new aws.CloudFormation();
  const startTime = await getReliableStartTime();
  const recheckIfBefore = new Date(startTime.getTime() - (1000 * cachePeriodSeconds /* ms */));
  if (stack.DriftInformation &&
    (stack.DriftInformation.StackDriftStatus == 'NOT_CHECKED'
      || stack.DriftInformation.LastCheckTimestamp! < recheckIfBefore)) {
    console.log();
    const spinnerStartTime = new Date();
    const spinnerText = "Checking for stack drift.";
    const spinner = mkSpinner(cli.xterm(240)(spinnerText));
    const {StackDriftDetectionId} = await cfn.detectStackDrift({StackName: stack.StackName}).promise();
    while (true) {
      const statusResponse = await cfn.describeStackDriftDetectionStatus({StackDriftDetectionId}).promise();
      spinner.stop();
      if (statusResponse.DetectionStatus !== "DETECTION_IN_PROGRESS") {
        break;
      } else {
        spinner.start();
        spinner.text = cli.xterm(240)(`${spinnerText} ${calcElapsedSeconds(spinnerStartTime)} seconds elapsed.`);
        await timeout(3 * 1000);
      }
    }
  }
}

export function summarizeResourceDrifts(drifts: aws.CloudFormation.StackResourceDrifts) {
  if (drifts.length > 0) {
    console.log();
    console.log(formatSectionHeading('Drifted Resources:'));

    const idPadding = calcPadding(drifts, d => d.LogicalResourceId);
    const resourceTypePadding = calcPadding(drifts, d => d.ResourceType);
    for (const drift of drifts) {
      console.log(
        formatLogicalId(sprintf(` %-${idPadding}s`, drift.LogicalResourceId)),
        cli.blackBright(sprintf(`%-${resourceTypePadding}s`, drift.ResourceType)),
        cli.blackBright(drift.PhysicalResourceId),
      );
      console.log(`  ${cli.red(drift.StackResourceDriftStatus)}`);
      if (drift.PropertyDifferences) {
        const diffString = yaml.dump(drift.PropertyDifferences)
        console.log(diffString.replace(/^(?!\s*$)/mg, '   '));
      }
    }
  } else {
    console.log();
    console.log('No drift detected. Stack resources are in sync with template.')
  }
}

export async function describeStackDriftMain(argv: GenericCLIArguments): Promise<number> {
  const StackName = await getStackNameFromArgsAndConfigureAWS(argv);
  const region = getCurrentAWSRegion();
  const stackPromise = getStackDescription(StackName);
  const stack = await stackPromise; // we wait here in case the stack doesn't exist: better error messages this way.
  await summarizeStackDefinition(StackName, region, true, stackPromise);
  await updateStackDriftData(stack, argv.driftCache);
  const drifts = await getAllStackResourceDrifts(StackName);
  summarizeResourceDrifts(drifts);
  return SUCCESS;
}
