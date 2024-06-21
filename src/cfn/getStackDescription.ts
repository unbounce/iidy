import { TERMINAL } from './statusTypes';

import * as _ from 'lodash';
import * as aws from 'aws-sdk'

export async function getStackDescription(StackName: string, expectTerminalStatus: boolean = false): Promise<aws.CloudFormation.Stack> {
  const cfn = new aws.CloudFormation();
  const stacks = await (async () => {
    if (expectTerminalStatus) {
      while (!_.includes(TERMINAL, (await cfn.describeStacks({StackName}).promise()).Stacks![0].StackStatus)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    return await cfn.describeStacks({StackName}).promise();
  })();
  if (_.isUndefined(stacks.Stacks) || stacks.Stacks.length < 1) {
    throw new Error(`${StackName} not found. Has it been deleted? Check the AWS Console.`);
  } else {
    return stacks.Stacks[0];
  }
}
