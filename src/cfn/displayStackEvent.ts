import * as aws from 'aws-sdk'
import * as wrapAnsi from 'wrap-ansi';
import * as cli from 'cli-color';

import {sprintf} from 'sprintf-js';
import def from '../default';
import {
  COLUMN2_START,
  DEFAULT_STATUS_PADDING,
  renderTimestamp,
  formatTimestamp,
  formatDuration,
  formatLogicalId,
  colorizeResourceStatus
} from './formatting';

export let getStrippedLength: (s: string) => number;
// TODO declare module for this:
getStrippedLength = require('cli-color/get-stripped-length'); // tslint:disable-line


export function displayStackEvent(ev: aws.CloudFormation.StackEvent, statusPadding = DEFAULT_STATUS_PADDING, durationSeconds?: number) {
  const tty: any = process.stdout; // tslint:disable-line
  const screenWidth = def(130, tty.columns);
  const status = def('', ev.ResourceStatus);
  const timingString = durationSeconds ? cli.xterm(252)(` (${formatDuration(durationSeconds)})`) : '';

  const reason = def('', ev.ResourceStatusReason).replace(/.*Initiated/, '');
  const resourceTypePadding = 40;
  // const resourceIdPadding = 35;
  const LogicalResourceId = def('', ev.LogicalResourceId);

  let line = sprintf(` %s %s `,
    formatTimestamp(renderTimestamp(ev.Timestamp)),
    colorizeResourceStatus(status, statusPadding)
  );
  const columnOfResourceType = getStrippedLength(line);
  line += sprintf(`%-${resourceTypePadding}s `, ev.ResourceType);
  process.stdout.write(line);
  const finalPart = formatLogicalId(LogicalResourceId) + timingString;
  if (getStrippedLength(line) + getStrippedLength(finalPart) < screenWidth) {
    process.stdout.write(finalPart);
    line += finalPart; // we don't need to write it again but want to record its length for use below
  } else {
    line = ' '.repeat(columnOfResourceType + 3) + finalPart;
    process.stdout.write('\n' + line);
  }
  if (reason.length > 0) {
    let reasonColor;
    if (status.indexOf('FAIL') > -1 || reason.indexOf('fail') > -1) {
      reasonColor = cli.red;
    } else {
      reasonColor = cli.blackBright;
    }
    if (reason.length + getStrippedLength(line) < screenWidth) {
      console.log(' ' + reasonColor(reason));
    } else {
      process.stdout.write('\n');
      const breakColumn = screenWidth - (COLUMN2_START + 1);
      for (const ln of wrapAnsi(reasonColor(reason), breakColumn).split('\n')) {
        console.log(' '.repeat(COLUMN2_START + 1) + ln);
      }
    }
  } else {
    process.stdout.write('\n');
  }
}
