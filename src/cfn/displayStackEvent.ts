import * as aws from 'aws-sdk';
import * as wrapAnsi from 'wrap-ansi';
import * as cli from 'cli-color';

import {sprintf} from 'sprintf-js';

import {writeLine, writeRaw} from '../output';
import def from '../default';
import {
  COLUMN2_START,
  DEFAULT_STATUS_PADDING,
  renderTimestamp,
  formatTimestamp,
  formatLogicalId,
  colorizeResourceStatus
} from './formatting';

import * as getStrippedLength from 'cli-color/get-stripped-length';

export function displayStackEvent(ev: aws.CloudFormation.StackEvent, statusPadding = DEFAULT_STATUS_PADDING) {
  const tty: any = process.stdout; // tslint:disable-line
  const screenWidth = def(130, tty.columns);
  const status = def('', ev.ResourceStatus);
  const reason = def('', ev.ResourceStatusReason).replace(/.*Initiated/, '');
  const resourceTypePadding = 40;
  const LogicalResourceId = def('', ev.LogicalResourceId);
  let line = sprintf(` %s %s `, formatTimestamp(renderTimestamp(ev.Timestamp)), colorizeResourceStatus(status, statusPadding));
  const columnOfResourceType = getStrippedLength(line);
  line += sprintf(`%-${resourceTypePadding}s `, ev.ResourceType);
  writeRaw(line);
  if (getStrippedLength(line) + LogicalResourceId.length < screenWidth) {
    writeRaw(formatLogicalId(LogicalResourceId));
    line += LogicalResourceId;
  } else {
    line = ' '.repeat(columnOfResourceType + 3) + formatLogicalId(LogicalResourceId);
    writeRaw('\n' + line);
  }
  if (reason.length > 0) {
    let reasonColor;
    if (status.indexOf('FAIL') > -1 || reason.indexOf('fail') > -1) {
      reasonColor = cli.red;
    } else {
      reasonColor = cli.blackBright;
    }
    if (reason.length + getStrippedLength(line) < screenWidth) {
      writeLine(' ' + reasonColor(reason));
    } else {
      writeRaw('\n');
      const breakColumn = screenWidth - (COLUMN2_START + 1);
      for (const ln of wrapAnsi(reasonColor(reason), breakColumn).split('\n')) {
        writeLine(' '.repeat(COLUMN2_START + 1) + ln);
      }
    }
  } else {
    writeRaw('\n');
  }
}
