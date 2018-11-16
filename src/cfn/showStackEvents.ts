import * as _ from 'lodash';
import * as aws from 'aws-sdk'
import * as cli from 'cli-color';

import {displayStackEvent} from './displayStackEvent';
import {getAllStackEvents} from './getAllStackEvents';

export async function showStackEvents(StackName: string, limit = 10, eventsPromise?: Promise<aws.CloudFormation.StackEvent[]>) {
  let evs = eventsPromise ? await eventsPromise : await getAllStackEvents(StackName);
  evs = _.sortBy(evs, (ev) => ev.Timestamp)
  const selectedEvs = evs.slice(Math.max(0, evs.length - limit), evs.length);
  const statusPadding = _.max(_.map(evs, (ev) => (ev.ResourceStatus as string).length))
  for (const ev of selectedEvs) {
    displayStackEvent(ev, statusPadding);
  }
  if (evs.length > selectedEvs.length) {
    console.log(cli.blackBright(` ${selectedEvs.length} of ${evs.length} total events shown`))
  }
}
