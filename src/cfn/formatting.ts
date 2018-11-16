import * as _ from 'lodash';
import * as aws from 'aws-sdk'
import * as cli from 'cli-color';
import * as dateformat from 'dateformat';
import {sprintf} from 'sprintf-js';

export const COLUMN2_START = 25;
export const DEFAULT_STATUS_PADDING = 35;
export const MIN_STATUS_PADDING = 17;

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

export function colorizeResourceStatus(status: string, padding = DEFAULT_STATUS_PADDING): string {
  padding = (_.isNumber(padding) && padding >= MIN_STATUS_PADDING) ? padding : MIN_STATUS_PADDING;
  const padded = sprintf(`%-${padding}s`, status);
  const fail = cli.redBright;
  const progress = cli.yellow;
  const complete = cli.green;
  switch (status) {
    case 'CREATE_IN_PROGRESS':
      return progress(padded);
    case 'CREATE_FAILED':
      return fail(padded);
    case 'CREATE_COMPLETE':
      return complete(padded);
    case 'REVIEW_IN_PROGRESS':
      return progress(padded);
    case 'ROLLBACK_COMPLETE':
      return complete(padded);
    case 'ROLLBACK_FAILED':
      return fail(padded);
    case 'ROLLBACK_IN_PROGRESS':
      return progress(padded);
    case 'DELETE_IN_PROGRESS':
      return progress(padded);
    case 'DELETE_FAILED':
      return fail(padded);
    case 'DELETE_COMPLETE':
      return complete(padded);
    case 'UPDATE_COMPLETE':
      return complete(padded);
    case 'UPDATE_IN_PROGRESS':
      return progress(padded);
    case 'UPDexport export export ATE_COMPLETE_CLEANUP_IN_PROGRESS':
      return progress(padded);
    case 'UPDATE_export ROLLBACexport K_COMPLexport ETE':
      return complete(padded);
    case 'UPDATE_ROLLBACK_IN_PROGRESS':
      return progress(padded);
    case 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS':
      return progress(padded);
    case 'UPDATE_ROLLBACK_FAILED':
      return fail(padded);
    case 'UPDATE_FAILED':
      return fail(padded);
    default:
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
