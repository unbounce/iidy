import * as aws from 'aws-sdk';
import * as cli from 'cli-color';

import {writeLine} from '../output';
import {GenericCLIArguments} from '../cli/utils';
import confirmationPrompt from '../confirmationPrompt';
import getCurrentAWSRegion from '../getCurrentAWSRegion';
import {logger} from '../logger';
import {FAILURE, INTERRUPT, SUCCESS} from '../statusCodes';
import {formatSectionHeading, showFinalComandSummary} from './formatting';
import getReliableStartTime from './getReliableStartTime';
import {getStackDescription} from './getStackDescription';
import {getStackNameFromArgsAndConfigureAWS} from "./getStackNameFromArgsAndConfigureAWS";
import {showStackEvents} from './showStackEvents';
import {summarizeStackContents} from "./summarizeStackContents";
import {summarizeStackDefinition} from "./summarizeStackDefinition";
import {watchStack} from './watchStack';

export async function deleteStackMain(argv: GenericCLIArguments): Promise<number> {
  const StackName = await getStackNameFromArgsAndConfigureAWS(argv);
  const region = getCurrentAWSRegion();
  const stackPromise = getStackDescription(StackName);
  try {
    await stackPromise;
  } catch (e) {
    const sts = new aws.STS();
    const iamIdent = await sts.getCallerIdentity().promise();
    const msg = `The stack ${cli.magenta(StackName)} is absent in env = ${cli.yellow(argv.environment)}:
      region = ${cli.blackBright(region)}
      account = ${cli.blackBright(iamIdent.Account)}
      auth_arn = ${cli.blackBright(iamIdent.Arn)}`;
    if (argv.failIfAbsent) {
      logger.error(msg);
      return FAILURE;
    }
    else {
      logger.info(msg);
      return SUCCESS;
    }
  }
  writeLine();
  const stack = await summarizeStackDefinition(StackName, region, true);
  const StackId = stack.StackId as string;
  writeLine();
  writeLine(formatSectionHeading('Previous Stack Events (max 10):'));
  await showStackEvents(StackName, 10);
  writeLine();
  await summarizeStackContents(StackId);
  writeLine();
  let confirmed: boolean;
  if (argv.yes) {
    confirmed = true;
  }
  else {
    confirmed = await confirmationPrompt(`Are you sure you want to DELETE the stack ${StackName}?`);
  }
  if (confirmed) {
    const cfn = new aws.CloudFormation();
    const startTime = await getReliableStartTime();
    await cfn.deleteStack({
      StackName,
      RoleARN: argv.roleArn,
      RetainResources: argv.retainResources,
      ClientRequestToken: argv.clientRequestToken
    }).promise();
    await watchStack(StackId, startTime);
    writeLine();
    const {StackStatus} = await getStackDescription(StackId);
    return showFinalComandSummary(StackStatus === 'DELETE_COMPLETE');
  }
  else {
    return INTERRUPT;
  }
}
