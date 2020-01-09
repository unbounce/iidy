import * as aws from 'aws-sdk';
import * as cli from 'cli-color';
import * as _ from 'lodash';
import * as querystring from 'querystring';

import {writeLine} from '../output';
import def from '../default';
import {
  colorizeResourceStatus,
  formatSectionHeading,
  prettyFormatTags,
  printSectionEntry,
  renderTimestamp,
  prettyFormatParameters
} from './formatting';
import {getStackDescription} from './getStackDescription';

export async function summarizeStackDefinition(
  StackName: string,
  region: string,
  showTimes = false,
  stackPromise?: Promise<aws.CloudFormation.Stack>)
  : Promise<aws.CloudFormation.Stack> {
  writeLine(formatSectionHeading('Stack Details:'));
  // TODO replace the stackPromise arg with just a stack as we're not leveraging the deferred awaits
  stackPromise = (stackPromise ? stackPromise : getStackDescription(StackName));
  const cfn = new aws.CloudFormation();
  const stackPolicyPromise = cfn.getStackPolicy({StackName}).promise();
  const stack = await stackPromise;
  const StackId = stack.StackId as string;
  const tagsAsMap = _.fromPairs(_.map(stack.Tags, (tag) => [tag.Key, tag.Value]));
  if (tagsAsMap.StackSetName) {
    printSectionEntry('Name (StackSet):', `${cli.blackBright(stack.StackName)} ${cli.magenta(tagsAsMap.StackSetName)}`);
  }
  else {
    printSectionEntry('Name:', cli.magenta(stack.StackName));
  }
  if (stack.Description) {
    const descriptionColor = stack.StackName.startsWith('StackSet') ? cli.magenta : cli.blackBright;
    printSectionEntry('Description:', descriptionColor(stack.Description));
  }
  printSectionEntry('Status', colorizeResourceStatus(stack.StackStatus));
  printSectionEntry('Capabilities:', cli.blackBright(_.isEmpty(stack.Capabilities) ? 'None' : stack.Capabilities));
  printSectionEntry('Service Role:', cli.blackBright(def('None', stack.RoleARN)));
  printSectionEntry('Tags:', cli.blackBright(prettyFormatTags(stack.Tags)));
  printSectionEntry('Parameters:', cli.blackBright(prettyFormatParameters(stack.Parameters)));
  printSectionEntry('DisableRollback:', cli.blackBright(stack.DisableRollback));
    printSectionEntry('TerminationProtection:', cli.blackBright(stack.EnableTerminationProtection) +
                      (stack.EnableTerminationProtection ? '🔒 ' : ''));
  //output.writeLine('Stack OnFailure Mode:', cli.blackBright(OnFailure));
  if (showTimes) {
    printSectionEntry('Creation Time:', cli.blackBright(renderTimestamp(stack.CreationTime)));
    if (!_.isUndefined(stack.LastUpdatedTime)) {
      printSectionEntry('Last Update Time:', cli.blackBright(renderTimestamp(stack.LastUpdatedTime)));
    }
  }
  if (!_.isUndefined(stack.TimeoutInMinutes)) {
    printSectionEntry('Timeout In Minutes:', cli.blackBright(stack.TimeoutInMinutes));
  }
  printSectionEntry('NotificationARNs:', cli.blackBright(_.isEmpty(stack.NotificationARNs) ? 'None' : stack.NotificationARNs));
  const StackPolicy = await stackPolicyPromise;
  if (StackPolicy.StackPolicyBody) {
    // json roundtrip to remove whitespace
    printSectionEntry('Stack Policy Source:', cli.blackBright(JSON.stringify(JSON.parse(StackPolicy.StackPolicyBody!))));
  }
  printSectionEntry('ARN:', cli.blackBright(stack.StackId));
  printSectionEntry('Console URL:', cli.blackBright(`https://${region}.console.aws.amazon.com/cloudformation/home`
    + `?region=${region}#/stack/detail?stackId=${querystring.escape(StackId)}`));
  return stack;
}
