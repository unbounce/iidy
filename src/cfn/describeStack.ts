import * as _ from 'lodash';
import * as aws from 'aws-sdk'
import * as jmespath from 'jmespath';

import getCurrentAWSRegion from '../getCurrentAWSRegion';
import def from '../default';
import {SUCCESS} from '../statusCodes';
import {formatSectionHeading} from './formatting';
import {GenericCLIArguments} from '../cli/utils';

import {getStackNameFromArgsAndConfigureAWS} from "./getStackNameFromArgsAndConfigureAWS";
import {summarizeStackContents} from "./summarizeStackContents";
import {summarizeStackDefinition} from "./summarizeStackDefinition";
import {getAllStackEvents} from "./getAllStackEvents";
import {showStackEvents} from './showStackEvents';
import {getStackDescription} from './getStackDescription';

export async function describeStackMain(argv: GenericCLIArguments): Promise<number> {
  const StackName = await getStackNameFromArgsAndConfigureAWS(argv);
  const region = getCurrentAWSRegion();
  const stackPromise = getStackDescription(StackName);
  const stack = await stackPromise; // we wait here in case the stack doesn't exist: better error messages this way.
  if (argv.query) { //
    const cfn = new aws.CloudFormation();
    const {StackResources} = await cfn.describeStackResources({StackName}).promise();
    const Resources = _.fromPairs(_.map(StackResources, (r) => [r.LogicalResourceId, r]));
    const combined = _.merge({Resources}, stack);
    console.log(JSON.stringify(jmespath.search(combined, argv.query), null, ' '));
    return SUCCESS;
  }
  else {
    const stackEventsPromise = getAllStackEvents(StackName);
    await summarizeStackDefinition(StackName, region, true, stackPromise);
    const StackId = stack.StackId as string;
    console.log();
    const eventCount = def(50, argv.events);
    console.log(formatSectionHeading(`Previous Stack Events (max ${eventCount}):`));
    await showStackEvents(StackName, eventCount, stackEventsPromise);
    console.log();
    await summarizeStackContents(StackId, stackPromise);
    return SUCCESS;
  }
}
