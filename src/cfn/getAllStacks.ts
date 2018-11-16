import * as aws from 'aws-sdk';
import * as _ from 'lodash';
import def from '../default';

export async function getAllStacks() {
  const cfn = new aws.CloudFormation();
  let res = await cfn.describeStacks().promise();
  let stacks = def([], res.Stacks);
  while (!_.isUndefined(res.NextToken)) {
    res = await cfn.describeStacks({NextToken: res.NextToken}).promise();
    stacks = stacks.concat(def([], res.Stacks));
  }
  return stacks;
}
