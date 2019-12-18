import * as _ from 'lodash';
import * as aws from 'aws-sdk'
import {IN_PROGRESS, TERMINAL} from './statusTypes';

export type ResourceEventTimingEntry = {
  start: aws.CloudFormation.StackEvent;
  complete?: aws.CloudFormation.StackEvent;
};
export type LogicalIdToTimings = {
  [LogicalId: string]: ResourceEventTimingEntry[]
};

export function calcEventTimings(events: aws.CloudFormation.StackEvent[]) {
  const resourceTimings: LogicalIdToTimings = {};
  const timeToCompletion: {[EventId: string]: number} = {};
  for (const ev of events) {
    if (!ev.LogicalResourceId) {
      continue;
    }
    if (!resourceTimings[ev.LogicalResourceId]) {
      resourceTimings[ev.LogicalResourceId] = [];
    }
    const previousTimingEntry = resourceTimings[ev.LogicalResourceId][0];

    if (_.includes(TERMINAL, ev.ResourceStatus)) {
      if (previousTimingEntry) {
        previousTimingEntry.complete = ev;
        timeToCompletion[ev.EventId] = Math.ceil(
          (+(ev.Timestamp) - +(previousTimingEntry.start.Timestamp)) / 1000);
      } else {
        // TODO how should we handle missing enties
      }
    } else if (_.includes(IN_PROGRESS, ev.ResourceStatus)) {
      if (previousTimingEntry && _.isUndefined(previousTimingEntry.complete)) {
        continue;
      } else {
        resourceTimings[ev.LogicalResourceId].unshift({start: ev});
      }

    }
  }
  return {timeToCompletion, resourceTimings};
}

export default calcEventTimings;
