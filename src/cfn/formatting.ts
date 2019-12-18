import * as aws from 'aws-sdk';
import * as cli from 'cli-color';
import * as dateformat from 'dateformat';
import * as _ from 'lodash';
import {sprintf} from 'sprintf-js';
import {FAILURE, SUCCESS} from '../statusCodes';
import {COMPLETE, FAILED, IN_PROGRESS} from './statusTypes';

export const COLUMN2_START = 25;
export const DEFAULT_STATUS_PADDING = 35;
export const MIN_STATUS_PADDING = 17;
export const MAX_PADDING = 60;

export function renderTimestamp(ts: Date) {
  return dateformat(ts);
}

export const formatTimestamp = (s: string) => cli.xterm(253)(s);

export const formatSectionHeading = (s: string) => cli.xterm(255)(cli.bold(s));
export const formatSectionLabel = (s: string) => cli.xterm(255)(s);
export const formatSectionEntry = (label: string, data: string): string =>
  ' ' + formatSectionLabel(sprintf(`%-${COLUMN2_START - 1}s `, label)) + data + '\n';
export const printSectionEntry = (label: string, data: string): boolean =>
  process.stdout.write(formatSectionEntry(label, data));

export const formatLogicalId = (s: string) => cli.xterm(252)(s);
export const formatStackOutputName = formatLogicalId;
export const formatStackExportName = formatLogicalId;

export function calcPadding<T>(items: T[], selector: (x:T) => string): number {
  return Math.min(_.max(_.map(items, i => selector(i).length)) as number, MAX_PADDING);
}

export function colorizeResourceStatus(status: string, padding = DEFAULT_STATUS_PADDING): string {
  padding = (_.isNumber(padding) && padding >= MIN_STATUS_PADDING) ? padding : MIN_STATUS_PADDING;
  const padded = sprintf(`%-${padding}s`, status);
  const fail = cli.redBright;
  const progress = cli.yellow;
  const complete = cli.green;

  if (_.includes(FAILED, status)) {
    return fail(padded);
  } else if (_.includes(COMPLETE, status)) {
    return complete(padded);
  } else if (_.includes(IN_PROGRESS, status)) {
    return progress(padded);
  } else {
    return padded;
  }

}

export const prettyFormatSmallMap = (map: {[key: string]: string}): string => {
  let out = '';
  _.forOwn(map, (v, key) => {
    if (out !== '') {
      out += ', ';
    }
    out += key + '=' + v;
  })
  return out;
}

export const prettyFormatTags = (tags?: aws.CloudFormation.Tags): string => {
  if (_.isUndefined(tags) || tags.length === 0) {
    return '';
  }
  return prettyFormatSmallMap(_.fromPairs(_.map(tags, (tag) => [tag.Key, tag.Value])));
}

export const prettyFormatParameters = (params?: aws.CloudFormation.Parameters): string => {
  if (_.isUndefined(params) || params.length === 0) {
    return '';
  }
  return prettyFormatSmallMap(_.fromPairs(_.map(params, p => [p.ParameterKey, p.ParameterValue])));
}

export function showFinalComandSummary(wasSuccessful: boolean): number {
  if (wasSuccessful) {
    console.log(formatSectionHeading(sprintf(`%-${COLUMN2_START}s`, 'Command Summary:')),
                cli.black(cli.bgGreenBright('Success')), '👍');
    return SUCCESS;
  } else {
    console.log(formatSectionHeading(sprintf(`%-${COLUMN2_START}s`, 'Command Summary:')),
                cli.bgRedBright('Failure'), ' (╯°□°）╯︵ ┻━┻ ', 'Fix and try again.');
    return FAILURE;
  }
}

export function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [
    h ? `${h}h` : 0,
    m ? `${m}m` : 0,
    s ? `${s}s` : 0,
  ].filter(a => a).join(' ');
}
