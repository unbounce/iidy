import * as _ from 'lodash';
import * as aws from 'aws-sdk'

import def from '../default';
import eventIsFromSubstack from './eventIsFromSubstack';

const getSubStacksFromEvents = (events: aws.CloudFormation.StackEvents): Set<string> => {
  const subStackIds = new Set();
  events.forEach((ev) => {
    if (eventIsFromSubstack(ev)) {
      subStackIds.add(ev.PhysicalResourceId as string);
    }
  });
  return subStackIds;
};

export async function getAllStackEvents(StackName: string, includeSubStacks = true, subStacksToIgnore?: Set<string>) {
  const cfn = new aws.CloudFormation({maxRetries: 12}); // higher than our default of 10
  let res = await cfn.describeStackEvents({StackName}).promise();
  let events = def([], res.StackEvents);
  while (!_.isUndefined(res.NextToken)) {
    res = await cfn.describeStackEvents({StackName, NextToken: res.NextToken}).promise();
    events = events.concat(def([], res.StackEvents));
  }
  events = _.sortBy(events, (ev) => ev.Timestamp);
  if (includeSubStacks) {
    const subStackIds = getSubStacksFromEvents(events);
    for (const subStackId of subStackIds) {
      if (!subStacksToIgnore || !subStacksToIgnore.has(subStackId)) {
        events = events.concat(await getAllStackEvents(subStackId));
      }
    }
  }
  return events;
}
