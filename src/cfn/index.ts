import * as fs from 'fs';
import * as pathmod from 'path';
import * as process from 'process';
import * as child_process from 'child_process';
import * as url from 'url';

import * as _ from 'lodash';
import * as aws from 'aws-sdk'
import {Md5} from 'ts-md5/dist/md5';
import * as request from 'request-promise-native';
import * as handlebars from 'handlebars';

import * as dateformat from 'dateformat';

import {Arguments} from 'yargs';

import * as querystring from 'querystring';
import {sprintf} from 'sprintf-js';
import * as cli from 'cli-color';
import * as wrapAnsi from 'wrap-ansi';
import * as ora from 'ora';
import * as inquirer from 'inquirer';
import * as nameGenerator from 'project-name-generator';

let getStrippedLength: (s: string) => number;
// TODO declare module for this:
getStrippedLength = require('cli-color/get-stripped-length'); // tslint:disable-line

import * as yaml from '../yaml';
import {logger} from '../logger';
import getReliableTime from '../getReliableTime';
import getCurrentAWSRegion from '../getCurrentAWSRegion';
import configureAWS from '../configureAWS';
import {AWSRegion} from '../aws-regions';
import timeout from '../timeout';
import filehash from '../filehash';
import normalizePath from '../normalizePath';
import def from '../default';
import {diff} from '../diff';
import {SUCCESS, FAILURE, INTERRUPT} from '../statusCodes';

import {
  readFromImportLocation,
  transform,
  PreprocessOptions,
  interpolateHandlebarsString,
  importLoaders,
  ExtendedCfnDoc
} from '../preprocess';
import {getKMSAliasForParameter} from '../params';
import {GlobalArguments} from '../cli';

export type GenericCLIArguments = GlobalArguments & Arguments;

export type CfnOperation = 'CREATE_STACK' | 'UPDATE_STACK' | 'CREATE_CHANGESET' | 'EXECUTE_CHANGESET' | 'ESTIMATE_COST';

export type StackArgs = {
  StackName: string
  Template: string
  ApprovedTemplateLocation?: string
  Region?: AWSRegion
  Profile?: string
  Capabilities?: aws.CloudFormation.Capabilities
  Tags?: {[key: string]: string}
  Parameters?: {[key: string]: string}
  NotificationARNs?: aws.CloudFormation.NotificationARNs
  AssumeRoleARN?: string
  ServiceRoleARN?: string
  RoleARN?: string // DEPRECATED in favour of ServiceRoleArn
  TimeoutInMinutes?: number
  OnFailure?: 'ROLLBACK' | 'DELETE' | 'DO_NOTHING'
  DisableRollback?: boolean
  EnableTerminationProtection?: boolean
  StackPolicy?: string | object,
  ResourceTypes?: string[],

  ClientRequestToken?: string, //aws.CloudFormation.ClientToken,
  // for updates
  UsePreviousTemplate?: boolean,

  CommandsBefore?: string[]
}

async function getReliableStartTime(): Promise<Date> {
  const startTime = await getReliableTime();
  startTime.setTime(startTime.getTime() - 500); // to be safe
  // TODO warn about inaccurate local clocks as that will affect the calculation of elapsed time.
  return startTime;
}

// http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-listing-event-history.html
// CREATE_COMPLETE | CREATE_FAILED | CREATE_IN_PROGRESS |
// DELETE_COMPLETE | DELETE_FAILED | DELETE_IN_PROGRESS |
// DELETE_SKIPPED | UPDATE_COMPLETE | UPDATE_FAILED |
// UPDATE_IN_PROGRESS.

// StackStatus — values include: "CREATE_IN_PROGRESS",
// "CREATE_FAILED", "CREATE_COMPLETE", "ROLLBACK_IN_PROGRESS",
// "ROLLBACK_FAILED", "ROLLBACK_COMPLETE", "DELETE_IN_PROGRESS",
// "DELETE_FAILED", "DELETE_COMPLETE", "UPDATE_IN_PROGRESS",
// "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS", "UPDATE_COMPLETE",
// "UPDATE_ROLLBACK_IN_PROGRESS", "UPDATE_ROLLBACK_FAILED",
// "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS",
// "UPDATE_ROLLBACK_COMPLETE", "REVIEW_IN_PROGRESS"

const terminalStackStates = [
  'CREATE_COMPLETE',
  'CREATE_FAILED',
  'ROLLBACK_COMPLETE',
  'ROLLBACK_FAILED',
  'DELETE_COMPLETE',
  'DELETE_FAILED',
  'UPDATE_COMPLETE',
  'UPDATE_FAILED',
  'UPDATE_ROLLBACK_COMPLETE',
  'UPDATE_ROLLBACK_FAILED',
  'REVIEW_IN_PROGRESS'
];


const DEFAULT_STATUS_PADDING = 35;
const MIN_STATUS_PADDING = 17;

function colorizeResourceStatus(status: string, padding = DEFAULT_STATUS_PADDING): string {
  padding = (_.isNumber(padding) && padding >= MIN_STATUS_PADDING) ? padding : MIN_STATUS_PADDING;
  const padded = sprintf(`%-${padding}s`, status)
  const fail = cli.redBright;
  const progress = cli.yellow;
  const complete = cli.green;
  switch (status) {
    case 'CREATE_IN_PROGRESS':
      return progress(padded)
    case 'CREATE_FAILED':
      return fail(padded)
    case 'CREATE_COMPLETE':
      return complete(padded)
    case 'REVIEW_IN_PROGRESS':
      return progress(padded);
    case 'ROLLBACK_COMPLETE':
      return complete(padded);
    case 'ROLLBACK_FAILED':
      return fail(padded);
    case 'ROLLBACK_IN_PROGRESS':
      return progress(padded)
    case 'DELETE_IN_PROGRESS':
      return progress(padded)
    case 'DELETE_FAILED':
      return fail(padded);
    case 'DELETE_COMPLETE':
      return complete(padded)
    case 'UPDATE_COMPLETE':
      return complete(padded)
    case 'UPDATE_IN_PROGRESS':
      return progress(padded);
    case 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS':
      return progress(padded);
    case 'UPDATE_ROLLBACK_COMPLETE':
      return complete(padded)
    case 'UPDATE_ROLLBACK_IN_PROGRESS':
      return progress(padded);
    case 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS':
      return progress(padded);
    case 'UPDATE_ROLLBACK_FAILED':
      return fail(padded)
    case 'UPDATE_FAILED':
      return fail(padded);
    default:
      return padded;
  }
}

function renderTimestamp(ts: Date) {
  return dateformat(ts);
}

const COLUMN2_START = 25;
const formatTimestamp = (s: string) => cli.xterm(253)(s);

const formatSectionHeading = (s: string) => cli.xterm(255)(cli.bold(s));
const formatSectionLabel = (s: string) => cli.xterm(255)(s);
const formatSectionEntry = (label: string, data: string): string =>
  ' ' + formatSectionLabel(sprintf(`%-${COLUMN2_START - 1}s `, label)) + data + '\n';
const printSectionEntry = (label: string, data: string): boolean =>
  process.stdout.write(formatSectionEntry(label, data));

const formatLogicalId = (s: string) => cli.xterm(252)(s);
const formatStackOutputName = formatLogicalId;
const formatStackExportName = formatLogicalId;

function displayStackEvent(ev: aws.CloudFormation.StackEvent, statusPadding = DEFAULT_STATUS_PADDING) {
  const tty: any = process.stdout;   // tslint:disable-line
  const screenWidth = def(130, tty.columns);
  const status = def('', ev.ResourceStatus);
  const reason = def('', ev.ResourceStatusReason).replace(/.*Initiated/, '');
  const resourceTypePadding = 40;
  // const resourceIdPadding = 35;
  const LogicalResourceId = def('', ev.LogicalResourceId);
  let line = sprintf(` %s %s `,
    formatTimestamp(renderTimestamp(ev.Timestamp)),
    colorizeResourceStatus(status, statusPadding))
  const columnOfResourceType = getStrippedLength(line);
  line += sprintf(`%-${resourceTypePadding}s `, ev.ResourceType)
  process.stdout.write(line);

  if (getStrippedLength(line) + LogicalResourceId.length < screenWidth) {
    process.stdout.write(formatLogicalId(LogicalResourceId));
    line += LogicalResourceId;
  } else {
    line = ' '.repeat(columnOfResourceType + 3) + formatLogicalId(LogicalResourceId);
    process.stdout.write('\n' + line);
  }
  if (reason.length > 0) {
    let reasonColor;
    if (status.indexOf('FAIL') > -1 || reason.indexOf('fail') > -1) {
      reasonColor = cli.red;
    } else {
      reasonColor = cli.blackBright
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

const objectToCFNTags =
  (obj: object): aws.CloudFormation.Tags =>
    _.map(_.toPairs(obj),
      // TODO handle UsePreviousValue for updates
      ([Key, Value]) => {return {Key, Value: Value.toString()}});

const objectToCFNParams =
  (obj: {[key: string]: string}): aws.CloudFormation.Parameters =>
    _.map(_.toPairs(obj),
      // TODO handle UsePreviousValue for updates
      ([ParameterKey, ParameterValue]) => {
        return {ParameterKey, ParameterValue: ParameterValue.toString()}
      })

async function showStackEvents(StackName: string, limit = 10, eventsPromise?: Promise<aws.CloudFormation.StackEvent[]>) {
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

const eventIsFromSubstack = (ev: aws.CloudFormation.StackEvent): boolean =>
  ev.PhysicalResourceId != '' &&
  (ev.ResourceType === 'AWS::CloudFormation::Stack') &&
  ev.StackId != ev.PhysicalResourceId

const getSubStacksFromEvents = (events: aws.CloudFormation.StackEvents): Set<string> => {
  const subStackIds = new Set();
  events.forEach((ev) => {
    if (eventIsFromSubstack(ev)) {
      subStackIds.add(ev.PhysicalResourceId as string);
    }
  });
  return subStackIds;
};

async function getAllStackEvents(StackName: string, includeSubStacks = true, subStacksToIgnore?: Set<string>) {
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

const DEFAULT_EVENT_POLL_INTERVAL = 2;
async function watchStack(StackName: string, startTime: Date, pollInterval = DEFAULT_EVENT_POLL_INTERVAL, inactivityTimeout = 0) {
  // TODO passthrough of statusPadding
  console.log(formatSectionHeading(`Live Stack Events (${pollInterval}s poll):`))

  // TODO add a timeout for super long stacks
  const seen: {[key: string]: boolean} = {};
  const tty: any = process.stdout; // tslint:disable-line
  const spinner = ora({
    spinner: 'dots12',
    text: '',
    enabled: _.isNumber(tty.columns)
  });
  // TODO consider doing: const spinnerStart = new Date()
  // to ensure calcElapsedSeconds is accurate in the face of innacurate local clocks
  const calcElapsedSeconds = (since: Date) => Math.ceil((+(new Date()) - +(since)) / 1000);
  let lastEvTimestamp: Date = new Date();    // might be off because of drift
  let DONE = false;

  spinner.start();

  const spinnerInterval = setInterval(async () => {
    const secondsSinceLastEvent = calcElapsedSeconds(lastEvTimestamp);
    spinner.text = cli.xterm(240)(
      `${calcElapsedSeconds(startTime)} seconds elapsed total.`
      + ` ${secondsSinceLastEvent} since last event.`);

    if (inactivityTimeout > 0 && secondsSinceLastEvent > inactivityTimeout) {
      const stack = await getStackDescription(StackName);
      if (_.includes(terminalStackStates, stack.StackStatus)) {
        clearInterval(spinnerInterval);
        DONE = true;
        spinner.stop();
        logger.info('Timed out due to inactivity');
      }

    }
  }, 1000);

  const subStacksToIgnore = new Set();
  while (!DONE) {
    let evs = await getAllStackEvents(StackName, true, subStacksToIgnore);
    const statusPadding = _.max(_.map(evs, (ev) => (ev.ResourceStatus as string).length))
    for (const ev of evs) {
      if (eventIsFromSubstack(ev) && !seen[ev.EventId]) {
        if (_.includes(terminalStackStates, ev.ResourceStatus) && ev.Timestamp > startTime) {
          subStacksToIgnore.add(ev.PhysicalResourceId);
        } else {
          subStacksToIgnore.delete(ev.PhysicalResourceId);
        }
      }
      if (ev.Timestamp < startTime) {
        logger.debug('filtering event from past', {ev, startTime});
        seen[ev.EventId] = true
      }
      if (!seen[ev.EventId]) {
        logger.debug('displaying new event', {ev, startTime});
        spinner.stop();
        displayStackEvent(ev, statusPadding);
        lastEvTimestamp = ev.Timestamp;
      }
      if (ev.ResourceType === 'AWS::CloudFormation::Stack') {
        if (!eventIsFromSubstack(ev) &&
          (_.includes([ev.StackId, ev.StackName], StackName)) &&
          _.includes(terminalStackStates, ev.ResourceStatus) &&
          ev.Timestamp > startTime
        ) {
          spinner.stop();
          console.log(
            cli.blackBright(` ${calcElapsedSeconds(startTime)} seconds elapsed total.`));
          DONE = true;
        }
      }

      seen[ev.EventId] = true
    }
    if (!DONE) {
      spinner.start();
      await timeout(pollInterval * 1000);
    }
  }
  spinner.stop();
  clearInterval(spinnerInterval);
}

async function getAllStackExportsWithImports(StackId: string) {
  const cfn = new aws.CloudFormation();
  let res = await cfn.listExports().promise();
  const filterAndGetImports = (exportList: aws.CloudFormation.Exports) =>
    exportList
      .filter(ex => ex.ExportingStackId === StackId)
      .map(ex => {
        return {
          Name: ex.Name,
          Value: ex.Value,
          Imports: cfn.listImports({ExportName: ex.Name as string})
            .promise()
            .catch(e => {
              logger.debug(e); // no imports found
              return {Imports: []};
            })
        };
      });

  let exports = filterAndGetImports(def([], res.Exports));
  while (!_.isUndefined(res.NextToken)) {
    res = await cfn.listExports({NextToken: res.NextToken}).promise();
    exports = exports.concat(filterAndGetImports(def([], res.Exports)));
  }
  return exports;
}

async function showPendingChangesets(StackId: string, changeSetsPromise?: Promise<aws.CloudFormation.ListChangeSetsOutput>) {
  const cfn = new aws.CloudFormation();
  if (!changeSetsPromise) {
    changeSetsPromise = cfn.listChangeSets({StackName: StackId}).promise();
  }
  // TODO pagination if lots of changesets:
  let changeSets = def([], (await changeSetsPromise).Summaries);
  changeSets = _.sortBy(changeSets, (cs) => cs.CreationTime);
  if (changeSets.length > 0) {
    console.log();
    console.log(formatSectionHeading('Pending Changesets:'))
    for (const cs of changeSets) {
      printSectionEntry(
        formatTimestamp(renderTimestamp(cs.CreationTime as Date)),
        cli.magenta(cs.ChangeSetName) +
        ' ' +
        cs.Status +
        ' ' +
        def('', cs.StatusReason));
      if (!_.isEmpty(cs.Description)) {
        console.log('  Description:', cli.blackBright(cs.Description))
        console.log()
      }
      summarizeChangeSet(await cfn.describeChangeSet({StackName: StackId, ChangeSetName: cs.ChangeSetName!}).promise());
      console.log()
    }
  }
}

// TODO rename this
async function summarizeCompletedStackOperation(StackId: string, stackPromise?: Promise<aws.CloudFormation.Stack>): Promise<aws.CloudFormation.Stack> {
  // TODO handle this part for when OnFailure=DELETE and stack is gone ...
  //   this would be using a stackId instead
  const cfn = new aws.CloudFormation();
  const resourcesPromise = cfn.describeStackResources({StackName: StackId}).promise();
  const exportsPromise = getAllStackExportsWithImports(StackId);
  const changeSetsPromise = cfn.listChangeSets({StackName: StackId}).promise();
  const stack = await (stackPromise || getStackDescription(StackId));

  const resources = def([], (await resourcesPromise).StackResources);
  const MAX_PADDING = 60;
  if (resources.length > 0) {
    console.log(formatSectionHeading('Stack Resources:'));
    const idPadding = Math.min(
      _.max(_.map(resources, r => r.LogicalResourceId.length)) as number,
      MAX_PADDING);

    const resourceTypePadding = Math.min(
      _.max(_.map(resources, r => r.ResourceType.length)) as number,
      MAX_PADDING);

    for (const resource of resources) {
      console.log(
        formatLogicalId(sprintf(` %-${idPadding}s`, resource.LogicalResourceId)),
        cli.blackBright(sprintf(`%-${resourceTypePadding}s`, resource.ResourceType)),
        cli.blackBright(resource.PhysicalResourceId),
      );
    }
  }

  console.log()
  process.stdout.write(formatSectionHeading('Stack Outputs:'));
  const outputKeyPadding = Math.min(
    _.max(_.map(stack.Outputs, (output) => (output.OutputKey as string).length)) as number,
    MAX_PADDING);
  if (!_.isUndefined(stack.Outputs) && stack.Outputs.length > 0) {
    process.stdout.write('\n')
    for (const {OutputKey, OutputValue} of stack.Outputs) {
      console.log(formatStackOutputName(sprintf(` %-${outputKeyPadding}s`, OutputKey)),
        cli.blackBright(OutputValue));
    }
  } else {
    console.log(' ' + cli.blackBright('None'))
  }

  const exports = await exportsPromise;

  if (exports.length > 0) {
    console.log()
    console.log(formatSectionHeading('Stack Exports:'));
    const exportNamePadding = Math.min(
      _.max(_.map(exports, (ex) => (ex.Name as string).length)) as number,
      MAX_PADDING);
    for (const ex of exports) {
      console.log(formatStackExportName(sprintf(` %-${exportNamePadding}s`, ex.Name)),
        cli.blackBright(ex.Value));
      // TODO handle NextToken, which might happen on large sets of exports
      const imports = await ex.Imports;
      for (const imp of def([], imports.Imports)) {
        console.log(cli.blackBright(`  imported by ${imp}`));
      }
    }
  }
  console.log()

  console.log(formatSectionHeading(sprintf(`%-${COLUMN2_START}s`, 'Current Stack Status:')),
    colorizeResourceStatus(stack.StackStatus),
    def('', stack.StackStatusReason))

  await showPendingChangesets(StackId, changeSetsPromise);
  return stack;
}

function runCommandSet(commands: string[], cwd: string, handleBarsEnv?: object): string[] {
  // TODO: merge this with the demo script functionality see
  // https://stackoverflow.com/a/37217166 for a means of doing light
  // weight string templates of the input command
  // TODO might want to inject AWS_* envvars and helper bash functions as ENV vars
  console.log('==', 'Executing CommandsBefore from argsfile', '='.repeat(28));
  handlebars.registerHelper('filehash', (context: any) => filehash(normalizePath(cwd, context)));
  handlebars.registerHelper('filehashBase64', (context: any) => filehash(normalizePath(cwd, context), 'base64'));
  const expandedCommands: string[] = [];
  commands.forEach((command, index) => {
    const expandedCommand = interpolateHandlebarsString(command, handleBarsEnv || {}, "CommandsBefore");
    expandedCommands.push(expandedCommand);
    console.log(`\n-- Command ${index + 1}`, '-'.repeat(50))


    if (expandedCommand !== command) {
      console.log(cli.red('# raw command before processing handlebars variables:'))
      console.log(cli.blackBright(command))
      console.log(cli.red('# command after processing handlebars variables:'))
      console.log(cli.blackBright(expandedCommand))
    } else {
      console.log(cli.blackBright(command))
    }

    const spawnOptions = {
      cwd,
      shell: fs.existsSync('/bin/bash') ? '/bin/bash' : true, // TODO should we fail here if no bash?
      // TODO color stderr
      stdio: [0, 1, 2],
      // TODO extract definition of iidy_s3_upload to somewhere else
      env: _.merge(
        {
          'BASH_FUNC_iidy_filehash%%': `() {   shasum -p -a 256 "$1" | cut -f 1 -d ' '; }`,
          'BASH_FUNC_iidy_filehash_base64%%': `() { shasum -p -a 256 "$1" | cut -f 1 -d ' ' | xxd -r -p | base64; }`,
          'BASH_FUNC_iidy_s3_upload%%': `() {
  echo '>> NOTE: iidy_s3_upload is an experimental addition to iidy. It might be removed in future versions.'
  FILE=$1
  BUCKET=$2
  S3_KEY=$3
  aws --profile "$iidy_profile" --region "$iidy_region" s3api head-object --bucket "$BUCKET" --key "$S3_KEY" 2>&1 >/dev/null || \
        aws --profile "$iidy_profile" --region "$iidy_region" s3 cp "$FILE" "s3://$BUCKET/$S3_KEY";

 }`,
          // flatten out the environment to pass through
          'iidy_profile': _.get(handleBarsEnv, 'iidy.profile'),
          'iidy_region': _.get(handleBarsEnv, 'iidy.region'),
          'iidy_environment': _.get(handleBarsEnv, 'iidy.environment')
        },
        process.env)
    };
    console.log('--', `Command ${index + 1} Output`, '-'.repeat(25));
    const result = child_process.spawnSync(expandedCommand, [], spawnOptions);
    if (result.status > 0) {
      throw new Error(`Error running command (exit code ${result.status}):\n` + command);
    }
  });

  handlebars.unregisterHelper('filehash');
  console.log();
  console.log('==', 'End CommandsBefore', '='.repeat(48));
  console.log();

  return expandedCommands;
}

function parseS3HttpUrl(input: string) {
  const error = new Error(`HTTP URL '${input}' is not a well-formed S3 URL`);
  const uri = url.parse(input);

  if (typeof uri === "undefined") {
    throw error;
  } else {
    let bucket, key, region;
    const hostname = uri.hostname || '';
    const pathname = decodeURIComponent(uri.pathname || '');

    if (/^s3[\.-](\w{2}-\w{4,9}-\d\.)?amazonaws\.com/.test(hostname)) {
      bucket = pathname.split('/')[1];
      key = pathname.split('/').slice(2).join('/');
    } else if (/\.s3[\.-](\w{2}-\w{4,9}-\d\.)?amazonaws\.com/.test(hostname)) {
      bucket = hostname.split('.')[0];
      key = pathname.slice(1);
    } else {
      throw error;
    }

    if (/^s3\.amazonaws\.com/.test(uri.hostname || '')) {
      region = 'us-east-1';
    } else {
      const match = hostname.match(/^s3-(\w{2}-\w{4,9}-\d)?.amazonaws\.com/) || [];
      if (match[1]) {
        region = match[1];
      } else {
        throw error;
      }
    }

    return {bucket, key, region}
  }
}

function maybeSignS3HttpUrl(location: string) {
  const isUnsignedS3HttpUrl = location.match(/^http/) && location.match(/s3/) && !location.match(/Signature=/);
  if (isUnsignedS3HttpUrl) {
    const params = parseS3HttpUrl(location);
    const s3 = new aws.S3({region: params.region});
    return s3.getSignedUrl('getObject', {Bucket: params.bucket, Key: params.key});
  } else {
    return location;
  }
}

async function loadCFNStackPolicy(policy: string | object | undefined, baseLocation: string):
  Promise<{StackPolicyBody?: string, StackPolicyURL?: string}> {

  if (_.isUndefined(policy)) {
    return {};
  } else if (_.isString(policy)) {
    const location0 = policy;
    const shouldRender = (location0.trim().indexOf('render:') === 0);
    const location = maybeSignS3HttpUrl(location0.trim().replace(/^ *render: */, ''));
    const importData = await readFromImportLocation(location, baseLocation);
    if (!shouldRender && importData.importType === 's3') {
      throw new Error(`Use https:// urls when using a plain (non-rendered) StackPolicy from S3: ${location}`);
      // note, s3 urls are valid for the shouldRender case below
    } else if (!shouldRender && importData.importType === 'http') {
      return {StackPolicyURL: importData.resolvedLocation};
    } else {
      return {
        StackPolicyBody: shouldRender
          ? JSON.stringify(await transform(importData.doc, importData.resolvedLocation), null, ' ')
          : importData.data
      };
    }
  } else if (_.isObject(policy)) {
    return {StackPolicyBody: JSON.stringify(policy)}
  } else {
    return {}
  }
}

const TEMPLATE_MAX_BYTES = 51199
export async function loadCFNTemplate(location0: string, baseLocation: string, environment: string, options: PreprocessOptions = {}):
  Promise<{TemplateBody?: string, TemplateURL?: string}> {
  if (_.isUndefined(location0)) {
    return {};
  }
  const shouldRender = (location0.trim().indexOf('render:') === 0);
  const location = maybeSignS3HttpUrl(location0.trim().replace(/^ *render: */, ''));
  // We auto-sign any s3 http urls here ^ prior to reading from them
  // (via readFromImportLocation below) or passing them to CFN via
  // TemplateUrl. This allows iidy to handle cross-region
  // TemplateUrls. s3:// urls don't provide any means of encoding
  // the source region and CFN doesn't accept them.

  // TODO maybeSignS3HttpUrl might need updating later if we add
  // support for baseLocation here being an http url itself: i.e.
  // relative imports. This is probably an edge-case we don't need to
  // support but it's worth noting.

  if (!shouldRender && location.match(/^s3:/)) {
    throw new Error(`Use https:// urls when using a plain (non-rendered) Template from S3: ${location}`);
    // note, s3 urls are valid for the shouldRender case below
  } else if (!shouldRender && location.match(/^http/)) {
    // note the handling of unsigned s3 http urls above in maybeSignS3HttpUrl ^
    return {TemplateURL: location};
  } else {
    const importData = await readFromImportLocation(location, baseLocation);
    if (importData.data.indexOf('$imports:') > -1 && !shouldRender) {
      throw new Error(
        `Your cloudformation Template from ${location} appears to`
        + ' use iidy\'s yaml pre-processor syntax.\n'
        + ' You need to prefix the template location with "render:".\n'
        + ` e.g.   Template: "render:${location}"`
      );
    }

    importData.doc.$envValues = _.merge({}, importData.doc.$envValues, {iidy: {environment: environment, region: getCurrentAWSRegion()}});
    const body = shouldRender
      ? yaml.dump(await transform(importData.doc, importData.resolvedLocation, options))
      : importData.data;
    if (body.length >= TEMPLATE_MAX_BYTES) {
      throw new Error('Your cloudformation template is larger than the max allowed size. '
        + 'You need to upload it to S3 and reference it from there.')
    }
    return {TemplateBody: body};
  }
}

export async function getStackDescription(StackName: string): Promise<aws.CloudFormation.Stack> {
  const cfn = new aws.CloudFormation();
  const stacks = await cfn.describeStacks({StackName}).promise();
  if (_.isUndefined(stacks.Stacks) || stacks.Stacks.length < 1) {
    throw new Error(`${StackName} not found. Has it been deleted? Check the AWS Console.`);
  } else {
    return stacks.Stacks[0];
  }

}

async function summarizeStackDefinition(StackName: string, region: string, showTimes = false, stackPromise?: Promise<aws.CloudFormation.Stack>): Promise<aws.CloudFormation.Stack> {
  console.log(formatSectionHeading('Stack Details:'))

  stackPromise = (stackPromise ? stackPromise : getStackDescription(StackName));
  const cfn = new aws.CloudFormation();
  const stackPolicyPromise = cfn.getStackPolicy({StackName}).promise();
  const stack = await stackPromise;
  const StackId = stack.StackId as string
  const tagsAsMap = _.fromPairs(_.map(stack.Tags, (tag) => [tag.Key, tag.Value]));

  if (tagsAsMap.StackSetName) {
    printSectionEntry(
      'Name (StackSet):',
      `${cli.blackBright(stack.StackName)} ${cli.magenta(tagsAsMap.StackSetName)}`);
  } else {
    printSectionEntry('Name:', cli.magenta(stack.StackName));
  }

  if (stack.Description) {
    const descriptionColor = stack.StackName.startsWith('StackSet') ? cli.magenta : cli.blackBright;
    printSectionEntry('Description:', descriptionColor(stack.Description));
  }
  printSectionEntry('Status', colorizeResourceStatus(stack.StackStatus));
  printSectionEntry('Capabilities:', cli.blackBright(_.isEmpty(stack.Capabilities) ? 'None' : stack.Capabilities));
  printSectionEntry('Service Role:', cli.blackBright(def('None', stack.RoleARN)));

  printSectionEntry('Tags:', cli.blackBright(prettyFormatTags(stack.Tags)));
  printSectionEntry('DisableRollback:', cli.blackBright(stack.DisableRollback));
  printSectionEntry('TerminationProtection:', cli.blackBright(stack.EnableTerminationProtection));

  //console.log('Stack OnFailure Mode:', cli.blackBright(OnFailure));
  if (showTimes) {
    printSectionEntry('Creation Time:', cli.blackBright(renderTimestamp(stack.CreationTime)));
    if (!_.isUndefined(stack.LastUpdatedTime)) {
      printSectionEntry('Last Update Time:', cli.blackBright(renderTimestamp(stack.LastUpdatedTime)));
    }
  }
  if (!_.isUndefined(stack.TimeoutInMinutes)) {
    printSectionEntry('Timeout In Minutes:', cli.blackBright(stack.TimeoutInMinutes));
  }
  printSectionEntry('NotificationARNs:',
    cli.blackBright(_.isEmpty(stack.NotificationARNs) ? 'None' : stack.NotificationARNs));

  const StackPolicy = await stackPolicyPromise;
  if (StackPolicy.StackPolicyBody) {
    // json roundtrip to remove whitespace
    printSectionEntry('Stack Policy Source:',
      cli.blackBright(JSON.stringify(JSON.parse(StackPolicy.StackPolicyBody!))));
  }

  printSectionEntry('ARN:', cli.blackBright(stack.StackId));
  printSectionEntry(
    'Console URL:',
    cli.blackBright(`https://${region}.console.aws.amazon.com/cloudformation/home`
      + `?region=${region}#/stack/detail?stackId=${querystring.escape(StackId)}`))

  return stack;
}

const prettyFormatSmallMap = (map: {[key: string]: string}): string => {
  let out = '';
  _.forOwn(map, (v, key) => {
    if (out !== '') {
      out += ', ';
    }
    out += key + '=' + v;
  })
  return out;
}

const prettyFormatTags = (tags?: aws.CloudFormation.Tags): string => {
  if (_.isUndefined(tags) || tags.length === 0) {
    return '';
  }
  return prettyFormatSmallMap(_.fromPairs(_.map(tags, (tag) => [tag.Key, tag.Value])));
}

async function getAllStacks() {
  const cfn = new aws.CloudFormation();
  let res = await cfn.describeStacks().promise();
  let stacks = def([], res.Stacks);
  while (!_.isUndefined(res.NextToken)) {
    res = await cfn.describeStacks({NextToken: res.NextToken}).promise();
    stacks = stacks.concat(def([], res.Stacks));
  }
  return stacks;
}

async function listStacks(showTags = false, tagsFilter?: [string, string][]) {
  const stacksPromise = getAllStacks();
  console.log(cli.blackBright(`Creation/Update Time, Status, Name${showTags ? ', Tags' : ''}`))
  // TODO dry up the spinner code
  const tty: any = process.stdout; // tslint:disable-line
  const spinner = ora({
    spinner: 'dots12',
    text: '',
    enabled: _.isNumber(tty.columns)
  });
  spinner.start();
  const stacks = _.sortBy(await stacksPromise, (st) => def(st.CreationTime, st.LastUpdatedTime));
  spinner.stop();
  if (stacks.length === 0) {
    console.log('No stacks found');
    return SUCCESS;
  }

  const timePadding = 24;
  const statusPadding = _.max(_.map(stacks, ev => ev.StackStatus.length));

  for (const stack of stacks) {
    const tags = _.fromPairs(_.map(stack.Tags, (tag) => [tag.Key, tag.Value]));
    if (tagsFilter && !_.every(tagsFilter, ([k, v]) => tags[k] === v)) {
      // TODO support more advanced tag filters like: not-set, any, or in-set
      continue;
    }
    const lifecyle: string | undefined = tags.lifetime;
    let lifecyleIcon: string = '';
    if (stack.EnableTerminationProtection || lifecyle === 'protected') {
      // NOTE stack.EnableTerminationProtection is undefined for the
      // time-being until an upstream bug is fix by AWS
      lifecyleIcon = '🔒 ';
    } else if (lifecyle === 'long') {
      lifecyleIcon = '∞ ';
    } else if (lifecyle === 'short') {
      lifecyleIcon = '♺ ';
    }
    const baseStackName = stack.StackName.startsWith('StackSet-')
      ? `${cli.blackBright(stack.StackName)} ${tags.StackSetName || stack.Description || 'Unknown stack set instance'}`
      : stack.StackName;
    let stackName: string;
    if (stack.StackName.includes('production') || tags.environment === 'production') {
      stackName = cli.red(baseStackName);
    } else if (stack.StackName.includes('integration') || tags.environment === 'integration') {
      stackName = cli.xterm(75)(baseStackName);
    } else if (stack.StackName.includes('development') || tags.environment === 'development') {
      stackName = cli.xterm(194)(baseStackName);
    } else {
      stackName = baseStackName;
    }
    process.stdout.write(
      sprintf('%s %s %s %s\n',
        formatTimestamp(
          sprintf(`%${timePadding}s`,
            renderTimestamp(def(stack.CreationTime, stack.LastUpdatedTime)))),
        colorizeResourceStatus(stack.StackStatus, statusPadding),
        cli.blackBright(lifecyleIcon) + stackName,
        showTags ? cli.blackBright(prettyFormatTags(stack.Tags)) : ''
      ))

    if (stack.StackStatus.indexOf('FAILED') > -1 && !_.isEmpty(stack.StackStatusReason)) {
      console.log('  ', cli.blackBright(stack.StackStatusReason))
    }
  }
}

export async function addDefaultNotificationArn(args: StackArgs): Promise<StackArgs> {
  const ssm = new aws.SSM();
  const ssmLookup = await ssm.getParameter(
    {Name: '/iidy/default-notification-arn', WithDecryption: true}).promise().catch(() => null);
  if (ssmLookup && ssmLookup.Parameter && ssmLookup.Parameter.Value) {
    const TopicArn = ssmLookup.Parameter.Value;
    const sns = new aws.SNS();
    if (await sns.getTopicAttributes({TopicArn}).promise().return(true).catchReturn(false)) {
      args.NotificationARNs = (args.NotificationARNs || []).concat(TopicArn);
    } else {
      logger.warn(
        `iidy's default NotificationARN set in this region is invalid: ${TopicArn}`);
    }
  }
  return args;
}

export async function loadStackArgs(argv: GenericCLIArguments): Promise<StackArgs> {
  // TODO json schema validation
  const args = await _loadStackArgs(argv.argsfile, argv);
  if (argv.clientRequestToken) {
    args.ClientRequestToken = argv.clientRequestToken;
  }
  return addDefaultNotificationArn(args);
}

//export async function _loadStackArgs(argsfile: string, region?: AWSRegion, profile?: string, environment?: string): Promise<StackArgs> {
export async function _loadStackArgs(argsfile: string, argv: GenericCLIArguments): Promise<StackArgs> {
  const region: string | undefined = argv.region;
  const profile: string | undefined = argv.profile;
  const assumeRoleArn: string | undefined = argv.assumeRoleArn;
  const environment: string | undefined = argv.environment;
  const iidy_command = argv._.join(' ');

  let argsdata: any; // tslint:disable-line
  if (!fs.existsSync(argsfile)) {
    throw new Error(`stack args file "${argsfile}" not found`);
  } else if (pathmod.extname(argsfile) === '.json') {
    argsdata = JSON.parse(fs.readFileSync(argsfile).toString());
  } else if (_.includes(['.yaml', '.yml'], pathmod.extname(argsfile))) {
    argsdata = yaml.loadString(fs.readFileSync(argsfile), argsfile)
  } else {
    throw new Error(`Invalid stack args file "${argsfile}" extension`);
  }

  // There is chicken-and-egg situation between use of imports for
  // profile or region and the call to configureAWS. We need to
  // enforce that they be plain strings with no pre-processor magic.
  for (const key of ['Profile', 'AssumeRoleARN', 'Region']) {
    if (_.isObject(argsdata[key])) {
      if (environment && argsdata[key][environment]) {
        argsdata[key] = argsdata[key][environment];
        logger.debug(`resolving ${key}=${argsdata[key]} based on environment=${environment}`);
      } else {
        throw new Error(`environment "${environment}" not found in ${key} map: ${argsdata[key]}`);
      }
    } else if (argsdata[key] && !_.isString(argsdata[key])) {
      throw new Error(`The ${key} setting in stack-args.yaml must be a plain string or an environment map of strings.`);
    }
  }
  // have to configureAws before the call to transform as $imports might make AWS api calls.
  const cliOptionOverrides = _.pickBy(argv, (v: any, k: string) => !_.isEmpty(v) && _.includes(['region', 'profile', 'assumeRoleArn'], k));
  const argsfileSettings = {profile: argsdata.Profile, assumeRoleArn: argsdata.AssumeRoleARN, region: argsdata.Region};
  const mergedAWSSettings = _.merge(argsfileSettings, cliOptionOverrides);
  await configureAWS(mergedAWSSettings); // cliOptionOverrides trump argsfile

  if (environment) {
    if (!_.get(argsdata, ['Tags', 'environment'])) {
      argsdata.Tags = _.merge({environment}, argsdata.Tags);
    }
  }
  const finalRegion = getCurrentAWSRegion();
  argsdata.$envValues = _.merge(
    {}, argsdata.$envValues, {
      // TODO deprecate bare region/environment:
      region: finalRegion,
      environment,
      // new style with namespace to avoid clashes:
      iidy: {
        command: iidy_command,
        environment,
        region: finalRegion,
        profile: mergedAWSSettings.profile
      }
    });

  if (argsdata.CommandsBefore) {
    // TODO should we actually execute the commands if this is `iidy render`?
    if (_.includes(['create-stack', 'update-stack', 'create-changeset', 'create-or-update'], iidy_command)) {
      // The CommandsBefore strings are pre-processed for any handlebars
      // templates they contain. We call `transform` once here to get
      // the $envValues ($imports, $defs, etc.) and fully rendered
      // StackArgs so they're available to handlebars. It's called again
      // below to produce the final `stackArgsPass2` as these commands
      // might alter the values in $imports. For example, an import of
      // `filehash:lambda.zip` would change after the
      //
      const argsdataPass1: ExtendedCfnDoc = _.omit(_.cloneDeep(argsdata), ['CommandsBefore']);
      // NOTE any AWS api calls made in the imports will be made twice
      // because of the multiple passes. TODO use transformPostImports
      // instead and loadImports only once.
      const stackArgsPass1 = await transform(argsdataPass1, argsfile) as StackArgs;
      // TODO what about the rest of the $envValues from the imports and defs?
      const CommandsBeforeEnv = _.merge({
        iidy: {
          stackArgs: stackArgsPass1,
          stackName: argv.stackName || stackArgsPass1.StackName
        }
      }, argsdataPass1.$envValues);

      // We want `iidy render` to show the results of that pre-processing:
      argsdata.CommandsBefore = runCommandSet(
        argsdata.CommandsBefore,
        pathmod.dirname(argsfile),
        CommandsBeforeEnv);
    } else {
      // Not on an iidy command that require CommandsBefore to be processed
      // TODO ... do something more sensible here, such as escaping the commands
      delete argsdata.CommandsBefore;
    }
  }
  const stackArgsPass2 = await transform(argsdata, argsfile) as StackArgs;
  logger.debug('argsdata -> stackArgs', argsdata, '\n', stackArgsPass2);
  return stackArgsPass2;
};

async function stackArgsToCreateStackInput(stackArgs: StackArgs, argsFilePath: string, environment: string, stackName?: string)
  : Promise<aws.CloudFormation.CreateStackInput> {
  let templateLocation;

  if (stackArgs.ApprovedTemplateLocation) {
    const approvedLocation = await approvedTemplateVersionLocation(
      stackArgs.ApprovedTemplateLocation,
      stackArgs.Template,
      argsFilePath,
      environment
    );
    templateLocation = `https://s3.amazonaws.com/${approvedLocation.Bucket}/${approvedLocation.Key}`;
  } else {
    templateLocation = stackArgs.Template;
  }
  // Template is optional for updates and update changesets
  const {TemplateBody, TemplateURL} = await loadCFNTemplate(templateLocation, argsFilePath, environment);
  const {StackPolicyBody, StackPolicyURL} = await loadCFNStackPolicy(stackArgs.StackPolicy, argsFilePath);

  // TODO: DisableRollback
  // specify either DisableRollback or OnFailure, but not both
  const OnFailure = def('ROLLBACK', stackArgs.OnFailure)

  if (stackArgs.ApprovedTemplateLocation) {
    logger.debug(`ApprovedTemplateLocation: ${stackArgs.ApprovedTemplateLocation}`);
    logger.debug(`Original Template: ${stackArgs.Template}`);
    logger.debug(`TemplateURL with ApprovedTemplateLocation: ${TemplateURL}`);
  } else {
    logger.debug(`TemplateURL: ${TemplateURL}`);
  }
  if (stackArgs.RoleARN) {
    logger.warn('RoleARN in stack-args.yaml is deprecated. Use ServiceRoleARN');
  }

  return {
    StackName: def(stackArgs.StackName, stackName),
    Capabilities: stackArgs.Capabilities,
    NotificationARNs: stackArgs.NotificationARNs,
    RoleARN: stackArgs.ServiceRoleARN || stackArgs.RoleARN,
    OnFailure,
    TimeoutInMinutes: stackArgs.TimeoutInMinutes,
    ResourceTypes: stackArgs.ResourceTypes,
    Parameters: objectToCFNParams(def({}, stackArgs.Parameters)),
    Tags: objectToCFNTags(def({}, stackArgs.Tags)),
    TemplateBody,
    TemplateURL,
    StackPolicyBody,
    StackPolicyURL,
    ClientRequestToken: stackArgs.ClientRequestToken
  };
}

async function stackArgsToUpdateStackInput(
  stackArgs: StackArgs,
  argsFilePath: string,
  environment: string,
  stackName?: string)
  : Promise<aws.CloudFormation.UpdateStackInput> {
  const input0 = await stackArgsToCreateStackInput(stackArgs, argsFilePath, environment, stackName);
  delete input0.TimeoutInMinutes;
  delete input0.OnFailure;
  const input = input0 as aws.CloudFormation.UpdateStackInput;
  input.UsePreviousTemplate = stackArgs.UsePreviousTemplate;
  return input0;
}

async function stackArgsToCreateChangeSetInput(
  changeSetName: string,
  stackArgs: StackArgs,
  argsFilePath: string,
  environment: string,
  stackName?: string)
  : Promise<aws.CloudFormation.CreateChangeSetInput> {
  // TODO: ResourceTypes optionally locked down for changeset
  const input0 = await stackArgsToCreateStackInput(stackArgs, argsFilePath, environment, stackName);
  delete input0.TimeoutInMinutes;
  delete input0.OnFailure;
  delete input0.StackPolicyBody;
  delete input0.StackPolicyURL;
  const ClientToken = input0.ClientRequestToken; // damn CFN has inconsistent naming here
  delete input0.ClientRequestToken;
  const input = input0 as aws.CloudFormation.CreateChangeSetInput;
  input.ChangeSetName = changeSetName;
  input.ClientToken = ClientToken;
  return input;
}

function showFinalComandSummary(wasSuccessful: boolean): number {
  if (wasSuccessful) {
    console.log(formatSectionHeading(sprintf(`%-${COLUMN2_START}s`, 'Command Summary:')),
      cli.black(cli.bgGreenBright('Success')),
      '👍')
    return SUCCESS;
  } else {
    console.log(
      formatSectionHeading(sprintf(`%-${COLUMN2_START}s`, 'Command Summary:')),
      cli.bgRedBright('Failure'),
      ' (╯°□°）╯︵ ┻━┻ ',
      'Fix and try again.'
    )
    return FAILURE;
  }
}

async function isHttpTemplateAccessible(location?: string) {
  if (location) {
    try {
      await request.get(location);
      return true;
    } catch (e) {
      return false;
    }
  } else {
    return false;
  }
}

export async function doesStackExist(StackName: string): Promise<boolean> {
  const cfn = new aws.CloudFormation();
  return await cfn.describeStacks({StackName}).promise().thenReturn(true).catchReturn(false);
}

abstract class AbstractCloudFormationStackCommand {
  public region: AWSRegion

  readonly profile?: string;
  readonly assumeRoleArn?: string;
  readonly stackName: string;
  readonly argsfile: string;
  readonly environment: string;

  protected cfnOperation: CfnOperation;
  protected startTime: Date;
  protected cfn: aws.CloudFormation;
  protected expectedFinalStackStatus: string[];
  protected showTimesInSummary: boolean = true;
  protected showPreviousEvents: boolean = true;
  protected previousStackEventsPromise: Promise<aws.CloudFormation.StackEvents>;
  protected watchStackEvents: boolean = true;

  constructor(readonly argv: GenericCLIArguments, readonly stackArgs: StackArgs) {
    // note, this.region is set in _setup after the cal to configureAWS
    this.profile = this.argv.profile || this.stackArgs.Profile;// tslint:disable-line
    this.assumeRoleArn = this.argv.assumeRoleArn || this.stackArgs.AssumeRoleARN;// tslint:disable-line

    this.stackName = this.argv.stackName || this.stackArgs.StackName;// tslint:disable-line
    this.argsfile = argv.argsfile;
    this.environment = argv.environment;
  }

  async _setup() {
    const regionArg = this.argv.region || this.stackArgs.Region;
    await configureAWS(_.merge({}, this, {region: regionArg}));
    this.region = def(getCurrentAWSRegion(), regionArg);
    this.cfn = new aws.CloudFormation()
    if (this.showPreviousEvents) {
      this.previousStackEventsPromise = getAllStackEvents(this.stackName);
    }
  }

  async _updateStackTerminationPolicy() {
    if (_.isBoolean(this.stackArgs.EnableTerminationProtection)) {
      const cfn = new aws.CloudFormation();
      return cfn.updateTerminationProtection({
        StackName: this.stackName,
        EnableTerminationProtection: this.stackArgs.EnableTerminationProtection
      }).promise();
    }
  }

  async _showCommandSummary() {
    const sts = new aws.STS();
    const iamIdentPromise = sts.getCallerIdentity().promise();
    const roleARN = this.stackArgs.ServiceRoleARN || this.stackArgs.RoleARN;

    console.log(); // blank line
    console.log(formatSectionHeading('Command Metadata:'))
    printSectionEntry('CFN Operation:', cli.magenta(this.cfnOperation));
    printSectionEntry('iidy Environment:', cli.magenta(this.environment));
    printSectionEntry('Region:', cli.magenta(this.region));
    if (!_.isEmpty(this.profile)) {
      printSectionEntry('Profile:', cli.magenta(this.profile));
    }
    printSectionEntry(
      'CLI Arguments:',
      cli.blackBright(prettyFormatSmallMap(_.pick(this.argv, ['region', 'profile', 'argsfile']))));

    printSectionEntry('IAM Service Role:', cli.blackBright(def('None', roleARN)));

    const iamIdent = await iamIdentPromise;
    printSectionEntry('Current IAM Principal:', cli.blackBright(iamIdent.Arn));
    printSectionEntry('iidy Version:', cli.blackBright(require('../../package.json').version));

    console.log();
  }

  async run(): Promise<number> {
    await this._setup();
    await this._showCommandSummary();
    this.startTime = await getReliableStartTime();
    return this._run();
  }

  async _watchAndSummarize(stackId: string): Promise<number> {
    // Show user all the meta data and stack properties
    // TODO previous related stack, long-lived dependency stack, etc.

    // we use StackId below rather than StackName to be resilient to deletions
    const stackPromise = getStackDescription(stackId);
    await summarizeStackDefinition(stackId, this.region, this.showTimesInSummary, stackPromise);

    if (this.showPreviousEvents) {
      console.log();
      console.log(formatSectionHeading('Previous Stack Events (max 10):'))
      await showStackEvents(stackId, 10, this.previousStackEventsPromise);
    }

    console.log();
    if (this.watchStackEvents) {
      await watchStack(stackId, this.startTime);
    }

    console.log();
    const stack = await summarizeCompletedStackOperation(stackId);

    return showFinalComandSummary(_.includes(this.expectedFinalStackStatus, stack.StackStatus));
  }

  async _run(): Promise<number> {
    throw new Error('Not implemented');
  }

  async _runCreate() {
    if (_.isEmpty(this.stackArgs.Template)) {
      throw new Error('For create-stack you must provide at Template: parameter in your argsfile')
    };
    try {
      const createStackInput = await stackArgsToCreateStackInput(this.stackArgs, this.argsfile, this.environment, this.stackName);
      if (await this._requiresTemplateApproval(createStackInput.TemplateURL)) {
        return this._exitWithTemplateApprovalFailure();
      }
      const createStackOutput = await this.cfn.createStack(createStackInput).promise();
      await this._updateStackTerminationPolicy();
      return this._watchAndSummarize(createStackOutput.StackId as string);
    } catch (e) {
      if (e.message === 'CreateStack cannot be used with templates containing Transforms.') {
        logger.error(
          `Your stack template contains an AWS:: Transform so you need to use 'iidy create-or-update ${cli.red('--changeset')}'`)
        return INTERRUPT;
      } else {
        throw e;
      }
    }
  }

  async _runUpdate() {
    try {
      let updateStackInput = await stackArgsToUpdateStackInput(this.stackArgs, this.argsfile, this.environment, this.stackName);
      if (await this._requiresTemplateApproval(updateStackInput.TemplateURL)) {
        return this._exitWithTemplateApprovalFailure();
      }
      if (this.argv.stackPolicyDuringUpdate) {
        const {
          StackPolicyBody: StackPolicyDuringUpdateBody,
          StackPolicyURL: StackPolicyDuringUpdateURL
        } = await loadCFNStackPolicy(this.argv.stackPolicyDuringUpdate as string, pathmod.join(process.cwd(), 'dummyfile'));
        updateStackInput = _.merge({StackPolicyDuringUpdateBody, StackPolicyDuringUpdateURL}, updateStackInput);
      }
      await this._updateStackTerminationPolicy();
      // TODO consider conditionally calling setStackPolicy if the policy has changed
      const updateStackOutput = await this.cfn.updateStack(updateStackInput).promise();
      return this._watchAndSummarize(updateStackOutput.StackId as string);
    } catch (e) {
      if (e.message === 'No updates are to be performed.') {
        logger.info('No changes detected so no stack update needed.');
        return SUCCESS;
      } else if (e.message === 'UpdateStack cannot be used with templates containing Transforms.') {
        logger.error(
          `Your stack template contains an AWS:: Transform so you need to use 'iidy update-stack ${cli.red('--changeset')}'`)
        return INTERRUPT;
      } else {
        throw e;
      }
    }
  }

  async _requiresTemplateApproval(TemplateURL?: string): Promise<boolean> {
    return !!(this.stackArgs.ApprovedTemplateLocation && ! await isHttpTemplateAccessible(TemplateURL));
  }

  _exitWithTemplateApprovalFailure(): number {
    logger.error('Template version has not been approved or the current IAM principal does not have permission to access it. Run:');
    logger.error(`  iidy template-approval request ${this.argsfile}`);
    logger.error('to begin the approval process.');
    return FAILURE;
  }

}

class CreateStack extends AbstractCloudFormationStackCommand {
  cfnOperation: CfnOperation = 'CREATE_STACK';
  expectedFinalStackStatus = ['CREATE_COMPLETE'];
  showTimesInSummary = false;
  showPreviousEvents = false;

  async _run() {
    return this._runCreate();
  }
}

class UpdateStack extends AbstractCloudFormationStackCommand {
  cfnOperation: CfnOperation = 'UPDATE_STACK';
  expectedFinalStackStatus = ['UPDATE_COMPLETE'];

  async _run() {
    return this._runUpdate();
  }
}

function summarizeChangeSet(changeSet: aws.CloudFormation.DescribeChangeSetOutput) {
  const indent = '   ';
  for (const change of changeSet.Changes || []) {
    if (change.ResourceChange) {
      const resourceChange = change.ResourceChange;
      const sprintfTemplate = '  %-17s %-30s %s';
      switch (resourceChange.Action) {
        case 'Add':
          console.log(
            sprintf(sprintfTemplate,
              cli.green('Add'),
              resourceChange.LogicalResourceId,
              cli.blackBright(resourceChange.ResourceType)));
          break;
        case 'Remove':
          console.log(
            sprintf(sprintfTemplate,
              cli.red('Remove'),
              resourceChange.LogicalResourceId,
              cli.blackBright(resourceChange.ResourceType + ' ' + resourceChange.PhysicalResourceId)));
          break;
        case 'Modify':
          if (_.includes(['True', 'Conditional'], resourceChange.Replacement)) {
            console.log(
              sprintf(sprintfTemplate,
                cli.red('Replace' + (resourceChange.Replacement === 'Conditional' ? '?' : '')),
                resourceChange.LogicalResourceId,
                cli.blackBright(resourceChange.ResourceType + ' ' + resourceChange.PhysicalResourceId)
              ));
          } else {
            console.log(
              sprintf(sprintfTemplate,
                cli.yellow('Modify'),
                resourceChange.LogicalResourceId,
                cli.yellow(resourceChange.Scope || ''),
                cli.blackBright(resourceChange.ResourceType + ' ' + resourceChange.PhysicalResourceId)
              ));
          }
          if (resourceChange.Details) {
            console.log(cli.blackBright(yaml.dump(resourceChange.Details)));
          }
          break;
      }
    }
  }
}

class CreateChangeSet extends AbstractCloudFormationStackCommand {
  public changeSetName: string;
  public hasChanges: undefined | boolean;

  cfnOperation: CfnOperation = 'CREATE_CHANGESET'
  expectedFinalStackStatus = terminalStackStates
  watchStackEvents = false
  showPreviousEvents = false;

  async _run() {
    // TODO remove argv as an arg here. Too general

    const ChangeSetName = this.argv.changesetName || nameGenerator().dashed; // TODO parameterize
    this.changeSetName = ChangeSetName;
    const createChangeSetInput =
      await stackArgsToCreateChangeSetInput(ChangeSetName, this.stackArgs, this.argsfile, this.environment, this.stackName);
    const StackName = createChangeSetInput.StackName;
    createChangeSetInput.Description = this.argv.description;

    const stackExists = await doesStackExist(StackName);
    createChangeSetInput.ChangeSetType = stackExists ? 'UPDATE' : 'CREATE';

    if (await this._requiresTemplateApproval(createChangeSetInput.TemplateURL)) {
      return this._exitWithTemplateApprovalFailure();
    }
    // TODO check for exception: 'ResourceNotReady: Resource is not in the state changeSetCreateComplete'
    const _changeSetResult = await this.cfn.createChangeSet(createChangeSetInput).promise();
    await this._waitForChangeSetCreateComplete().catch(() => null); // catch for failed changesets
    const changeSet = await this.cfn.describeChangeSet({ChangeSetName, StackName}).promise();

    this.hasChanges = !_.isEmpty(changeSet.Changes);

    if (changeSet.Status === 'FAILED') {
      logger.error(changeSet.StatusReason as string, 'Deleting failed changeset.');
      await this.cfn.deleteChangeSet({ChangeSetName, StackName}).promise();
      return FAILURE;
    }
    console.log();

    console.log('AWS Console URL for full changeset review:',
      cli.blackBright(
        `https://${this.region}.console.aws.amazon.com/cloudformation/home?region=${this.region}#`
        + `/changeset/detail?stackId=${querystring.escape(changeSet.StackId as string)}`
        + `&changeSetId=${querystring.escape(changeSet.ChangeSetId as string)}`));

    await showPendingChangesets(StackName);
    // TODO diff createChangeSetInput.TemplateBody
    if (!stackExists) {
      console.log('Your new stack is now in REVIEW_IN_PROGRESS state. To create the resources run the following \n  ' +
        `iidy exec-changeset --stack-name ${this.stackName} ${this.argsfile} ${ChangeSetName}`);
      console.log();
    }
    showFinalComandSummary(true);
    return SUCCESS;
  }

  async _waitForChangeSetCreateComplete() {
    const StackName = this.stackName;

    const pollInterval = 1;     // seconds
    const startTime = this.startTime;
    const calcElapsedSeconds = (since: Date) => Math.ceil((+(new Date()) - +(since)) / 1000);

    const tty: any = process.stdout; // tslint:disable-line
    const spinner = ora({
      spinner: 'dots12',
      text: '',
      enabled: _.isNumber(tty.columns)
    });

    while (true) {
      const {Status, StatusReason} = await this.cfn.describeChangeSet({ChangeSetName: this.changeSetName, StackName}).promise();
      spinner.stop();
      if (Status === 'CREATE_COMPLETE') {
        break;
      } else if (Status === 'FAILED') {
        throw new Error(`Failed to create changeset: ${StatusReason}`);
      } else {
        spinner.start();
        spinner.text = cli.xterm(240)(
          `${calcElapsedSeconds(startTime)} seconds elapsed.`);
        await timeout(pollInterval * 1000);
      }
    }
  }
}


class ExecuteChangeSet extends AbstractCloudFormationStackCommand {
  cfnOperation: CfnOperation = 'EXECUTE_CHANGESET'
  expectedFinalStackStatus = ['UPDATE_COMPLETE', 'CREATE_COMPLETE']

  async _run() {
    await this.cfn.executeChangeSet(
      {
        ChangeSetName: this.argv.changesetName,
        ClientRequestToken: this.argv.clientRequestToken,
        StackName: this.stackName
      }).promise();
    return this._watchAndSummarize(this.stackName);
  }
}

class EstimateStackCost extends AbstractCloudFormationStackCommand {
  cfnOperation: CfnOperation = 'ESTIMATE_COST'

  async _run() {
    const {TemplateBody, TemplateURL, Parameters} =
      await stackArgsToCreateStackInput(this.stackArgs, this.argsfile, this.environment, this.stackName)
    const estimateResp = await this.cfn.estimateTemplateCost({TemplateBody, TemplateURL, Parameters}).promise();
    console.log('Stack cost estimator: ', estimateResp.Url);
    return SUCCESS;
  }
}

const wrapCommandCtor =
  (Ctor: new (argv: GenericCLIArguments, stackArgs: StackArgs) => AbstractCloudFormationStackCommand) =>
    async function(argv: GenericCLIArguments): Promise<number> {
      return new Ctor(argv, await loadStackArgs(argv)).run();
    }

export const createStackMain = wrapCommandCtor(CreateStack);
export const executeChangesetMain = wrapCommandCtor(ExecuteChangeSet);
export const estimateCost = wrapCommandCtor(EstimateStackCost);

export function parseTemplateBody(TemplateBody: string): object {
  if (TemplateBody.match(/^ *\{/) !== null) {
    return JSON.parse(TemplateBody);
  } else {
    return yaml.loadString(TemplateBody, '');
  }
}

export async function diffStackTemplates(StackName: string, stackArgs: StackArgs, argsfile: string, environment: string) {
  const cfn = new aws.CloudFormation();
  const {TemplateBody} = await cfn.getTemplate({StackName, TemplateStage: 'Original'}).promise();
  if (TemplateBody) {
    let oldTemplate = parseTemplateBody(TemplateBody);
    const {TemplateBody: newTemplateBody, TemplateURL: newTemplateURL} = await loadCFNTemplate(stackArgs.Template, argsfile, environment);
    let newTemplate: object;
    if (newTemplateURL) {
      const importData = await readFromImportLocation(newTemplateURL, argsfile);
      newTemplate = importData.doc;
    } else if (newTemplateBody) {
      newTemplate = parseTemplateBody(newTemplateBody);
    } else {
      throw new Error('Invalid template found');
    }

    console.log();
    diff(yaml.dump(oldTemplate), yaml.dump(newTemplate))
  }
}
export async function createOrUpdateStackMain(argv: GenericCLIArguments): Promise<number> {
  const stackArgs = await loadStackArgs(argv);
  const StackName = argv.stackName || stackArgs.StackName;
  const stackExists = await doesStackExist(StackName);
  if (stackExists) {
    return updateStackMain(argv, stackArgs);
  } else if (argv.changeset) {
    // TODO extract this into a separate createStackMain fn
    // TODO autodetect AWS::Serverless and default to changeset=true
    const changeSetRunner = new CreateChangeSet(argv, stackArgs);
    const createChangesetResult = await changeSetRunner.run();
    if (createChangesetResult > 0) {
      return createChangesetResult;
    } else {
      console.log()
      return await confirmChangesetExec(argv, changeSetRunner, stackArgs);
    }
  } else {
    return new CreateStack(argv, stackArgs).run();
  }
}

async function confirmChangesetExec(argv: GenericCLIArguments, changeSetRunner: CreateChangeSet, stackArgs: StackArgs): Promise<number> {
  let confirmed: boolean;
  if (argv.yes) {
    confirmed = true;
  } else {
    const resp = await inquirer.prompt(
      {
        name: 'confirm',
        type: 'confirm', default: false,
        message: `Do you want to execute this changeset now?`
      })
    confirmed = resp.confirm;
  }
  if (confirmed) {
    argv.changesetName = changeSetRunner.changeSetName;
    return new ExecuteChangeSet(argv, stackArgs).run();
  } else {
    console.log(`You can do so later using\n`
      + `  iidy exec-changeset -s ${changeSetRunner.stackName} ${changeSetRunner.argsfile} ${changeSetRunner.changeSetName}`);
    return INTERRUPT;
  }
}

export async function updateStackMain(argv: GenericCLIArguments, stackArgs?: StackArgs): Promise<number> {
  stackArgs = stackArgs || await loadStackArgs(argv);
  if (argv.changeset) {
    const region = getCurrentAWSRegion();
    const StackName = argv.stackName || stackArgs.StackName;
    const stack = await summarizeStackDefinition(StackName, region);
    const changeSetRunner = new CreateChangeSet(argv, stackArgs);

    if (argv.diff) {
      console.log()
      console.log(formatSectionHeading('Stack Template Diff:'))
      await diffStackTemplates(changeSetRunner.stackName, stackArgs, argv.argsfile, argv.environment!);
      console.log()
    }

    const createChangesetResult = await changeSetRunner.run();
    if (createChangesetResult > 0) {
      if (changeSetRunner.hasChanges) {
        return createChangesetResult;
      } else {
        logger.info('No changes to apply');
        return SUCCESS;
      }
    }
    console.log()
    return await confirmChangesetExec(argv, changeSetRunner, stackArgs);
  } else {
    return new UpdateStack(argv, stackArgs).run();
  }
};


export async function createChangesetMain(argv: GenericCLIArguments): Promise<number> {
  const changesetRunner = new CreateChangeSet(argv, await loadStackArgs(argv));
  const changesetExitCode = await changesetRunner.run();
  if (argv.watch && changesetExitCode === 0) {
    console.log();
    await watchStack(changesetRunner.stackName, new Date(), DEFAULT_EVENT_POLL_INTERVAL, argv.watchInactivityTimeout);
    console.log();
    await summarizeCompletedStackOperation(changesetRunner.stackName);
    return SUCCESS;
  } else {
    return changesetExitCode;
  }
};

export async function listStacksMain(argv: GenericCLIArguments): Promise<number> {
  await configureAWS(argv);
  const tagsFilter: [string, string][] = _.map(argv.tagFilter, (tf: string) => {
    const [key, ...value] = tf.split('=');
    return [key, value.join('=')] as [string, string];
  });
  await listStacks(argv.tags, tagsFilter);
  return SUCCESS;
}


export async function getStackNameFromArgsAndConfigureAWS(argv: GenericCLIArguments): Promise<string> {
  let StackName: string;
  if (/.*\.(yaml|yml)$/.test(argv.stackname) && fs.existsSync(argv.stackname)) {
    const stackArgs = await _loadStackArgs(argv.stackname, argv);
    return stackArgs.StackName;
  } else {
    await configureAWS(argv);
    return argv.stackname;
  }
}

export async function watchStackMain(argv: GenericCLIArguments): Promise<number> {
  const StackName = await getStackNameFromArgsAndConfigureAWS(argv);
  const region = getCurrentAWSRegion();
  const startTime = await getReliableStartTime();

  console.log();
  const stack = await summarizeStackDefinition(StackName, region, true);
  const StackId = stack.StackId as string;
  console.log();

  console.log(formatSectionHeading('Previous Stack Events (max 10):'))
  await showStackEvents(StackId, 10);

  console.log();
  await watchStack(StackId, startTime, DEFAULT_EVENT_POLL_INTERVAL, argv.inactivityTimeout);
  console.log();
  await summarizeCompletedStackOperation(StackId);
  return SUCCESS;
}

export async function describeStackMain(argv: GenericCLIArguments): Promise<number> {
  const StackName = await getStackNameFromArgsAndConfigureAWS(argv);
  const region = getCurrentAWSRegion();
  const stackPromise = getStackDescription(StackName);
  await stackPromise; // we wait here in case the stack doesn't exist: better error messages this way.
  const stackEventsPromise = getAllStackEvents(StackName);

  const stack = await summarizeStackDefinition(StackName, region, true, stackPromise);
  const StackId = stack.StackId as string;
  console.log();

  const eventCount = def(50, argv.events);
  console.log(formatSectionHeading(`Previous Stack Events (max ${eventCount}):`))
  await showStackEvents(StackName, eventCount, stackEventsPromise);
  console.log();
  await summarizeCompletedStackOperation(StackId, stackPromise);
  return SUCCESS;
}

export async function getStackInstancesMain(argv: GenericCLIArguments): Promise<number> {
  const StackName = await getStackNameFromArgsAndConfigureAWS(argv);
  const region = getCurrentAWSRegion();

  const ec2 = new aws.EC2();
  const instances = await ec2.describeInstances(
    {
      Filters: [{
        Name: 'tag:aws:cloudformation:stack-name',
        Values: [StackName]
      }]
    })
    .promise();

  for (const reservation of instances.Reservations || []) {
    for (const instance of reservation.Instances || []) {
      if (argv.short) {
        console.log(instance.PublicDnsName ? instance.PublicDnsName : instance.PrivateIpAddress);
      } else {
        const state = instance.State ? instance.State.Name : 'unknown';
        const placement = instance.Placement ? instance.Placement.AvailabilityZone : '';
        console.log(sprintf(
          '%-42s %-15s %s %-11s %s %s %s',
          instance.PublicDnsName,
          instance.PrivateIpAddress,
          instance.InstanceId,
          instance.InstanceType,
          state,
          placement,
          formatTimestamp(renderTimestamp(instance.LaunchTime as Date))
        ));
      }
    }
  }

  console.log(
    cli.blackBright(
      `https://console.aws.amazon.com/ec2/v2/home?region=${region}#Instances:tag:aws:cloudformation:stack-name=${StackName};sort=desc:launchTime`));
  return SUCCESS;
}

export async function getStackTemplateMain(argv: GenericCLIArguments): Promise<number> {
  const StackName = await getStackNameFromArgsAndConfigureAWS(argv);
  const TemplateStage = def('Original', argv.stage);

  const cfn = new aws.CloudFormation();
  const output = await cfn.getTemplate({StackName, TemplateStage}).promise();
  if (!output.TemplateBody) { // tslint:disable-line
    throw new Error('No template found');
  }
  process.stderr.write(`# Stages Available: ${output.StagesAvailable}\n`);
  process.stderr.write(`# Stage Shown: ${TemplateStage}\n\n`);
  const templateObj = parseTemplateBody(output.TemplateBody);
  switch (argv.format) {
    case 'yaml':
      console.log(yaml.dump(templateObj));
      break;
    case 'json':
      console.log(JSON.stringify(templateObj, null, ' '));
      break;
    case 'original':
      console.log(output.TemplateBody);
      break;
    default:
      console.log(output.TemplateBody);
  }
  return SUCCESS;
}

////////////////////////////////////////////////////////////////////////////////

export async function deleteStackMain(argv: GenericCLIArguments): Promise<number> {
  const StackName = await getStackNameFromArgsAndConfigureAWS(argv);
  const region = getCurrentAWSRegion();

  const stackPromise = getStackDescription(StackName);
  try {
    await stackPromise;
  } catch (e) {
    const sts = new aws.STS();
    const iamIdent = await sts.getCallerIdentity().promise();
    const msg = `The stack ${cli.magenta(StackName)} is absent in env = ${cli.yellow(argv.environment)}:
      region = ${cli.blackBright(region)}
      account = ${cli.blackBright(iamIdent.Account)}
      auth_arn = ${cli.blackBright(iamIdent.Arn)}`;
    if (argv.failIfAbsent) {
      logger.error(msg);
      return FAILURE;
    } else {
      logger.info(msg);
      return SUCCESS;
    }
  }
  console.log();
  const stack = await summarizeStackDefinition(StackName, region, true);
  const StackId = stack.StackId as string;
  console.log();

  console.log(formatSectionHeading('Previous Stack Events (max 10):'))
  await showStackEvents(StackName, 10);
  console.log();
  await summarizeCompletedStackOperation(StackId);
  console.log();

  let confirmed: boolean;
  if (argv.yes) {
    confirmed = true;
  } else {
    const resp = await inquirer.prompt(
      {
        name: 'confirm',
        type: 'confirm', default: false,
        message: `Are you sure you want to DELETE the stack ${StackName}?`
      })
    confirmed = resp.confirm;
  }
  if (confirmed) {
    const cfn = new aws.CloudFormation();
    // TODO --client-request-token
    const startTime = await getReliableStartTime();
    await cfn.deleteStack({StackName, RoleARN: argv.roleArn, RetainResources: argv.retainResources}).promise();
    await watchStack(StackId, startTime);
    console.log();
    const {StackStatus} = await getStackDescription(StackId);
    return showFinalComandSummary(StackStatus === 'DELETE_COMPLETE');
  } else {
    return INTERRUPT;
  }
}

export async function approvedTemplateVersionLocation(
  approvedTemplateLocation: string,
  templatePath: string,
  baseLocation: string,
  environment: string): Promise<{Bucket: string, Key: string}> {
  // const templatePath = path.resolve(path.dirname(location), templatePath);
  // const cfnTemplate = await fs.readFileSync(path.resolve(path.dirname(location), templatePath));
  const cfnTemplate = await loadCFNTemplate(templatePath, baseLocation, environment, {omitMetadata: true});

  if (cfnTemplate && cfnTemplate.TemplateBody) {
    const s3Url = url.parse(approvedTemplateLocation);
    const s3Path = s3Url.path ? s3Url.path : "";
    const s3Bucket = s3Url.hostname ? s3Url.hostname : "";

    const fileName = new Md5().appendStr(cfnTemplate.TemplateBody.toString()).end().toString()
    const fullFileName = `${fileName}${pathmod.extname(templatePath)}`

    return {
      Bucket: s3Bucket,
      Key: pathmod.join(s3Path.substring(1), fullFileName)
    };
  } else {
    throw new Error('Unable to determine versioned template location');
  }
}
