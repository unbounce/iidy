import * as fs from 'fs';
import * as pathmod from 'path';
import * as process from 'process';
import * as child_process from 'child_process';

import * as _ from 'lodash';
import * as aws from 'aws-sdk'

import * as dateformat from 'dateformat';

import {Arguments} from 'yargs';

import * as querystring from 'querystring';
import {sprintf} from 'sprintf-js';
import * as cli from 'cli-color';
import * as wrapAnsi from 'wrap-ansi';
import * as ora from 'ora';
import * as inquirer from 'inquirer';

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
import def from '../default';

import {readFromImportLocation, transform} from '../index';

export type CfnOperation = 'CREATE_STACK' | 'UPDATE_STACK' | 'CREATE_CHANGESET' | 'EXECUTE_CHANGESET' | 'ESTIMATE_COST';

export type StackArgs = {
  StackName: string
  Template: string
  Region?: AWSRegion
  Profile?: string
  Capabilities?: aws.CloudFormation.Capabilities
  Tags?: {[key: string]: string}
  Parameters?: {[key: string]: string}
  NotificationARNs?: aws.CloudFormation.NotificationARNs
  RoleARN?: string
  TimeoutInMinutes?: number
  OnFailure?: 'ROLLBACK' | 'DELETE' | 'DO_NOTHING'
  EnableTerminationProtection?: boolean
  StackPolicy?: string | object,
  ResourceTypes?: string[],

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
      ([Key, Value]) => {return {Key, Value}});

const objectToCFNParams =
  (obj: {[key: string]: string}): aws.CloudFormation.Parameters =>
    _.map(_.toPairs(obj),
      // TODO handle UsePreviousValue for updates
      ([ParameterKey, ParameterValue]) => {
        return {ParameterKey, ParameterValue: ParameterValue.toString()}
      })

async function showStackEvents(StackName: string, limit = 10) {
  let evs = (await getAllStackEvents(StackName));
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

async function getAllStackEvents(StackName: string) {
  const cfn = new aws.CloudFormation({maxRetries: 12}); // higher than our default of 10
  let res = await cfn.describeStackEvents({StackName}).promise();
  let events = def([], res.StackEvents);
  while (!_.isUndefined(res.NextToken)) {
    res = await cfn.describeStackEvents({StackName, NextToken: res.NextToken}).promise();
    events = events.concat(def([], res.StackEvents));
  }
  return events;
}

async function watchStack(StackName: string, startTime: Date, pollInterval = 2) {
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
  while (!DONE) {
    // TODO merge in the events of nested stacks
    let evs = await getAllStackEvents(StackName);
    spinner.stop();
    evs = _.sortBy(evs, (ev) => ev.Timestamp);
    const statusPadding = _.max(_.map(evs, (ev) => (ev.ResourceStatus as string).length))
    for (let ev of evs) {
      if (ev.Timestamp < startTime) {
        logger.debug('filtering event from past', ev = ev, startTime = startTime);
        seen[ev.EventId] = true
      }
      if (!seen[ev.EventId]) {
        logger.debug('displaying new event', ev = ev, startTime = startTime);
        displayStackEvent(ev, statusPadding);
        lastEvTimestamp = ev.Timestamp;
      }
      seen[ev.EventId] = true
      if (ev.ResourceType === 'AWS::CloudFormation::Stack') {
        if (_.includes(terminalStackStates, ev.ResourceStatus) && ev.Timestamp > startTime) {
          console.log(
            cli.blackBright(` ${calcElapsedSeconds(startTime)} seconds elapsed total.`));
          DONE = true;
        }
      }
    }
    if (!DONE) {
      spinner.start();
      spinner.text = cli.xterm(240)(
        `${calcElapsedSeconds(startTime)} seconds elapsed total.`
        + ` ${calcElapsedSeconds(lastEvTimestamp)} since last event.`);
      await timeout(pollInterval * 1000);
    }
  }
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


// TODO rename this
async function summarizeCompletedStackOperation(StackId: string)
  : Promise<aws.CloudFormation.Stack> {
  // TODO handle this part for when OnFailure=DELETE and stack is gone ...
  //   this would be using a stackId instead
  const cfn = new aws.CloudFormation();
  const exportsPromise = getAllStackExportsWithImports(StackId);
  const resourcesPromise = cfn.describeStackResources({StackName: StackId}).promise();
  const stack = await getStackDescription(StackId);

  const resources = def([], (await resourcesPromise).StackResources);
  const MAX_PADDING = 60;
  if (resources.length > 0) {
    console.log(formatSectionHeading('Stack Resources:'));
    const idPadding = Math.min(
      _.max(_.map(resources, r => r.LogicalResourceId.length)) as number,
      MAX_PADDING);

    for (const resource of resources) {
      console.log(
        formatLogicalId(sprintf(` %-${idPadding}s`, resource.LogicalResourceId)),
        cli.blackBright(resource.PhysicalResourceId)
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

  return stack;
}

function runCommandSet(commands: string[]) {
  // TODO: merge this with the demo script functionality see
  // https://stackoverflow.com/a/37217166 for a means of doing light
  // weight string templates of the input command
  for (const command of commands) {
    console.log('Running command:\n' + cli.blackBright(command))
    const result = child_process.spawnSync(command, [], {shell: true});
    if (result.status > 0) {
      throw new Error('Error running command: ' + command);
    } else {
      // TODO show stderr
      // stream the output line by line rather than waiting
      console.log('Command output: \n' + cli.blackBright(result.stdout.toString().trim()));
    }
  }
}

async function loadCFNStackPolicy(policy: string | object | undefined, baseLocation: string):
  Promise<{StackPolicyBody?: string, StackPolicyURL?: string}> {

  if (_.isUndefined(policy)) {
    return {};
  } else if (_.isString(policy)) {
    const location = policy;
    const shouldRender = (location.trim().indexOf('render:') === 0);
    const importData = await readFromImportLocation(location.trim().replace(/^ *render:/, ''), baseLocation);
    if (!shouldRender && importData.importType === 's3') {
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
async function loadCFNTemplate(location: string, baseLocation: string):
  Promise<{TemplateBody?: string, TemplateURL?: string}> {
  if (_.isUndefined(location)) {
    return {};
  }
  const importData = await readFromImportLocation(location.trim().replace(/^ *render:/, ''), baseLocation);
  const shouldRender = (location.trim().indexOf('render:') === 0);
  if (!shouldRender && importData.data.indexOf('$imports:') > -1) {
    throw new Error(
      `Your cloudformation Template from ${location} appears to`
      + ' use iidy\'s yaml pre-processor syntax.\n'
      + ' You need to prefix the template location with "render:".\n'
      + ` e.g.   Template: "render:${location}"`
    );
  }
  if (!shouldRender && importData.importType === 's3') {
    return {TemplateURL: importData.resolvedLocation};
  } else {
    const body = shouldRender
      ? yaml.dump(await transform(importData.doc, importData.resolvedLocation))
      : importData.data;
    if (body.length >= TEMPLATE_MAX_BYTES) {
      throw new Error('Your cloudformation template is larger than the max allowed size. '
        + 'You need to upload it to S3 and reference it from there.')
    }
    return {TemplateBody: body};
  }
}

async function getStackDescription(StackName: string): Promise<aws.CloudFormation.Stack> {
  const cfn = new aws.CloudFormation();
  const stacks = await cfn.describeStacks({StackName}).promise();
  if (_.isUndefined(stacks.Stacks) || stacks.Stacks.length < 1) {
    throw new Error(`${StackName} not found. Has it been deleted? Check the AWS Console.`);
  } else {
    return stacks.Stacks[0];
  }

}

async function summarizeStackProperties(StackName: string, region: string, showTimes = false): Promise<aws.CloudFormation.Stack> {
  const cfn = new aws.CloudFormation();
  const changeSetsPromise = cfn.listChangeSets({StackName}).promise();
  const stack = await getStackDescription(StackName);
  const StackId = stack.StackId as string
  console.log(formatSectionHeading('Stack Details:'))

  printSectionEntry('Name:', cli.magenta(stack.StackName));
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

  const StackPolicy = await cfn.getStackPolicy({StackName}).promise();
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

  const changeSets = def([], (await changeSetsPromise).Summaries);
  if (changeSets.length > 0) {
    console.log();
    console.log(formatSectionHeading('Pending Changesets:'))
    for (const cs of changeSets) {
      // colorize status
      console.log(formatTimestamp(renderTimestamp(cs.CreationTime as Date)),
        cli.magenta(cs.ChangeSetName),
        cs.ExecutionStatus,
        def('', cs.StatusReason));
      if (!_.isEmpty(cs.Description)) {
        console.log('  ', cli.blackBright(cs.Description))
      }
      // TODO describe the change set ...
    }
  }
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

async function listStacks(showTags = false) {
  let stacks = await getAllStacks();
  stacks = _.sortBy(stacks, (st) => def(st.CreationTime, st.LastUpdatedTime))
  if (stacks.length === 0) {
    console.log('No stacks found');
    return 0;
  }
  console.log(cli.blackBright(`Creation/Update Time, Status, Name${showTags ? ', Tags' : ''}`))
  const timePadding = (stacks[0].CreationTime.getDate() < (new Date).getDate())
    ? 24
    : 11;
  const statusPadding = _.max(_.map(stacks, ev => ev.StackStatus.length));

  for (const stack of stacks) {
    const tags = _.fromPairs(_.map(stack.Tags, (tag) => [tag.Key, tag.Value]));
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
    let stackName: string;
    if (stack.StackName.includes('production') || tags.environment === 'production') {
      stackName = cli.red(stack.StackName);
    } else if (stack.StackName.includes('integration') || tags.environment === 'integration') {
      stackName = cli.xterm(75)(stack.StackName);
    } else if (stack.StackName.includes('development') || tags.environment === 'development') {
      stackName = cli.xterm(194)(stack.StackName);
    } else {
      stackName = stack.StackName;
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



export async function loadStackArgs(argv: Arguments): Promise<StackArgs> {
  // TODO json schema validation
  return _loadStackArgs(argv.argsfile, argv.region, argv.profile);
}

export async function _loadStackArgs(argsfile: string, region?: AWSRegion, profile?: string): Promise<StackArgs> {
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
  if (argsdata.Profile && !_.isString(argsdata.Profile)) {
    throw new Error('The Profile setting in stack-args.yaml must be a plain string');
  }
  if (argsdata.Region && !_.isString(argsdata.Region)) {
    throw new Error('The Region setting in stack-args.yaml must be a plain string');
  }

  // have to do it before the call to transform
  await configureAWS(profile || argsdata.Profile, region || argsdata.Region); // tslint:disable-line


  if (argsdata.CommandsBefore) {
    // TODO improve CLI output of this and think about adding
    // descriptive names to the commands

    // TODO might want to inject ENV vars or handlebars into the
    // commands. Also the AWS_ENV
    console.log(formatSectionHeading('Preflight steps:'))
    console.log('Executing CommandsBefore from argsfile');
    runCommandSet(argsdata.CommandsBefore);
  }
  return await transform(argsdata, argsfile) as StackArgs;
  // ... do the normalization here
};

async function stackArgsToCreateStackInput(stackArgs: StackArgs, argsFilePath: string, stackName?: string)
  : Promise<aws.CloudFormation.CreateStackInput> {

  // Template is optional for updates and update changesets
  const {TemplateBody, TemplateURL} = await loadCFNTemplate(stackArgs.Template, argsFilePath);
  const {StackPolicyBody, StackPolicyURL} = await loadCFNStackPolicy(stackArgs.StackPolicy, argsFilePath);

  // TODO: ClientRequestToken, DisableRollback

  return {
    StackName: def(stackArgs.StackName, stackName),
    Capabilities: stackArgs.Capabilities,
    NotificationARNs: stackArgs.NotificationARNs,
    RoleARN: stackArgs.RoleARN,
    OnFailure: def('ROLLBACK', stackArgs.OnFailure),
    TimeoutInMinutes: stackArgs.TimeoutInMinutes,
    ResourceTypes: stackArgs.ResourceTypes,
    Parameters: objectToCFNParams(def({}, stackArgs.Parameters)),
    Tags: objectToCFNTags(def({}, stackArgs.Tags)),
    TemplateBody,
    TemplateURL,
    StackPolicyBody,
    StackPolicyURL
  };
}

async function stackArgsToUpdateStackInput(stackArgs: StackArgs, argsFilePath: string, stackName?: string)
  : Promise<aws.CloudFormation.UpdateStackInput> {
  const input0 = await stackArgsToCreateStackInput(stackArgs, argsFilePath, stackName);
  delete input0.TimeoutInMinutes;
  delete input0.OnFailure;
  const input = input0 as aws.CloudFormation.UpdateStackInput;
  input.UsePreviousTemplate = stackArgs.UsePreviousTemplate;
  return input0;
}

async function stackArgsToCreateChangeSetInput(
  changeSetName: string, stackArgs: StackArgs, argsFilePath: string, stackName?: string)
  : Promise<aws.CloudFormation.CreateChangeSetInput> {
  // TODO: ResourceTypes optionally locked down for changeset
  const input0 = await stackArgsToCreateStackInput(stackArgs, argsFilePath, stackName);
  delete input0.TimeoutInMinutes;
  delete input0.OnFailure;
  delete input0.StackPolicyBody;
  delete input0.StackPolicyURL;
  const input = input0 as aws.CloudFormation.CreateChangeSetInput;
  input.ChangeSetName = changeSetName;
  return input;
}

function showFinalComandSummary(wasSuccessful: boolean): number {
  if (wasSuccessful) {
    console.log(formatSectionHeading(sprintf(`%-${COLUMN2_START}s`, 'Command Summary:')),
      cli.black(cli.bgGreenBright('Success')),
      '👍')
    return 0;
  } else {
    console.log(
      formatSectionHeading(sprintf(`%-${COLUMN2_START}s`, 'Command Summary:')),
      cli.bgRedBright('Failure'),
      ' (╯°□°）╯︵ ┻━┻ ',
      'Fix and try again.'
    )
    return 1;
  }
}

abstract class AbstractCloudFormationStackCommand {
  region: AWSRegion
  readonly profile: string
  readonly stackName: string
  readonly argsfile: string

  protected readonly _cfnOperation: CfnOperation
  protected _startTime: Date
  protected _cfn: aws.CloudFormation
  protected readonly _expectedFinalStackStatus: string[]
  protected readonly _showTimesInSummary: boolean = true;
  protected readonly _showPreviousEvents: boolean = true;
  protected readonly _watchStackEvents: boolean = true;

  constructor(readonly argv: Arguments, readonly stackArgs: StackArgs) {
    this.region = this.argv.region || this.stackArgs.Region; // tslint:disable-line
    this.profile = this.argv.profile || this.stackArgs.Profile;// tslint:disable-line
    this.stackName = this.argv.stackName || this.stackArgs.StackName;// tslint:disable-line
    this.argsfile = argv.argsfile;
  }

  async _setup() {
    await configureAWS(this.profile, this.region)
    this.region = def(getCurrentAWSRegion(), this.region);
    this._cfn = new aws.CloudFormation()
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

    console.log(); // blank line
    console.log(formatSectionHeading('Command Metadata:'))
    printSectionEntry('CFN Operation:', cli.magenta(this._cfnOperation));
    printSectionEntry('Region:', cli.magenta(this.region));
    if (!_.isEmpty(this.profile)) {
      printSectionEntry('Profile:', cli.magenta(this.profile));
    }
    printSectionEntry(
      'CLI Arguments:',
      cli.blackBright(prettyFormatSmallMap(_.pick(this.argv, ['region', 'profile', 'argsfile']))));

    printSectionEntry('IAM Service Role:', cli.blackBright(def('None', this.stackArgs.RoleARN)));

    const iamIdent = await iamIdentPromise;
    printSectionEntry('Current IAM Principal:', cli.blackBright(iamIdent.Arn));
    console.log();
  }

  async run(): Promise<number> {
    await this._setup()
    await this._showCommandSummary()
    this._startTime = await getReliableStartTime();
    return this._run()
  }

  async _watchAndSummarize(stackId: string): Promise<number> {
    // Show user all the meta data and stack properties
    // TODO previous related stack, long-lived dependency stack, etc.

    // we use StackId below rather than StackName to be resilient to deletions
    await summarizeStackProperties(stackId, this.region, this._showTimesInSummary);

    if (this._showPreviousEvents) {
      console.log();
      console.log(formatSectionHeading('Previous Stack Events (max 10):'))
      await showStackEvents(stackId, 10);
    }

    console.log();
    if (this._watchStackEvents) {
      await watchStack(stackId, this._startTime);
    }

    console.log();
    const stack = await summarizeCompletedStackOperation(stackId);

    return showFinalComandSummary(_.includes(this._expectedFinalStackStatus, stack.StackStatus));
  }
  async _run(): Promise<number> {
    throw new Error('Not implemented');
  }
}

class CreateStack extends AbstractCloudFormationStackCommand {
  _cfnOperation: CfnOperation = 'CREATE_STACK'
  _expectedFinalStackStatus = ['CREATE_COMPLETE']
  _showTimesInSummary = false;
  _showPreviousEvents = false;

  async _run() {
    if (_.isEmpty(this.stackArgs.Template)) {
      throw new Error('For create-stack you must provide at Template: parameter in your argsfile')
    };
    const createStackInput = await stackArgsToCreateStackInput(this.stackArgs, this.argsfile, this.stackName)
    const createStackOutput = await this._cfn.createStack(createStackInput).promise();
    await this._updateStackTerminationPolicy();
    return this._watchAndSummarize(createStackOutput.StackId as string);
  }
}

class UpdateStack extends AbstractCloudFormationStackCommand {
  _cfnOperation: CfnOperation = 'UPDATE_STACK'
  _expectedFinalStackStatus = ['UPDATE_COMPLETE']

  async _run() {
    try {
      let updateStackInput = await stackArgsToUpdateStackInput(this.stackArgs, this.argsfile, this.stackName);
      if (this.argv.stackPolicyDuringUpdate) {
        const {
          StackPolicyBody: StackPolicyDuringUpdateBody,
          StackPolicyURL: StackPolicyDuringUpdateURL
        } = await loadCFNStackPolicy(this.argv.stackPolicyDuringUpdate as string, pathmod.join(process.cwd(), 'dummyfile'));
        updateStackInput = _.merge({StackPolicyDuringUpdateBody, StackPolicyDuringUpdateURL}, updateStackInput);
      }
      await this._updateStackTerminationPolicy();
      // TODO consider conditionally calling setStackPolicy if the policy has changed
      const updateStackOutput = await this._cfn.updateStack(updateStackInput).promise();
      return this._watchAndSummarize(updateStackOutput.StackId as string);
    } catch (e) {
      if (e.message === 'No updates are to be performed.') {
        logger.info('No changes detected so no stack update needed.');
        return 0;
      } else {
        throw e;
      }
    }
  }
}


class CreateChangeSet extends AbstractCloudFormationStackCommand {
  _cfnOperation: CfnOperation = 'CREATE_CHANGESET'
  _expectedFinalStackStatus = terminalStackStates
  _watchStackEvents = false

  async _run() {
    // TODO remove argv as an arg here. Too general

    const ChangeSetName = this.argv.changesetName; // TODO parameterize
    const createChangeSetInput =
      await stackArgsToCreateChangeSetInput(ChangeSetName, this.stackArgs, this.argsfile, this.stackName);
    const StackName = createChangeSetInput.StackName;
    createChangeSetInput.ChangeSetType = this.argv.changesetType;

    // TODO check for exception: 'ResourceNotReady: Resource is not in the state changeSetCreateComplete'

    const _changeSetResult = await this._cfn.createChangeSet(createChangeSetInput).promise();
    // TODO replace this with my own tighter polling
    await this._cfn.waitFor('changeSetCreateComplete', {ChangeSetName, StackName}).promise();
    const changeSet = await this._cfn.describeChangeSet({ChangeSetName, StackName}).promise();
    if (changeSet.Status === 'FAILED') {
      logger.error(changeSet.StatusReason as string);
      logger.info('Deleting changeset.')
      await this._cfn.deleteChangeSet({ChangeSetName, StackName}).promise();
      throw new Error('ChangeSet failed to create');
    }
    console.log(formatSectionHeading('Changeset:'));
    console.log(yaml.dump(changeSet));
    // ... need to branch off here and watch the events on the changeset
    // https://...console.aws.amazon.com/cloudformation/home?region=..#/changeset/detail?changeSetId=..&stackId=..
    console.log(cli.blackBright(
      `https://${this.region}.console.aws.amazon.com/cloudformation/home?region=${this.region}#`
      + `/changeset/detail?stackId=${querystring.escape(changeSet.StackId as string)}`
      + `&changeSetId=${querystring.escape(changeSet.ChangeSetId as string)}`));


    return this._watchAndSummarize(changeSet.StackId as string);
  }
}


class ExecuteChangeSet extends AbstractCloudFormationStackCommand {
  _cfnOperation: CfnOperation = 'EXECUTE_CHANGESET'
  _expectedFinalStackStatus = ['UPDATE_COMPLETE', 'CREATE_COMPLETE']

  async _run() {
    await this._cfn.executeChangeSet({ChangeSetName: this.argv.changesetName, StackName: this.stackName}).promise();
    return this._watchAndSummarize(this.stackName);
  }
}

class EstimateStackCost extends AbstractCloudFormationStackCommand {
  _cfnOperation: CfnOperation = 'ESTIMATE_COST'

  async _run() {
    const {TemplateBody, TemplateURL, Parameters} =
      await stackArgsToCreateStackInput(this.stackArgs, this.argsfile, this.stackName)
    const estimateResp = await this._cfn.estimateTemplateCost({TemplateBody, TemplateURL, Parameters}).promise();
    console.log('Stack cost estimator: ', estimateResp.Url);
    return 0;
  }
}

const wrapCommandCtor =
  (Ctor: new (argv: Arguments, stackArgs: StackArgs) => AbstractCloudFormationStackCommand) =>
    async function(argv: Arguments): Promise<number> {
      return new Ctor(argv, await loadStackArgs(argv)).run();
    }

export const createStackMain = wrapCommandCtor(CreateStack);
export const updateStackMain = wrapCommandCtor(UpdateStack);
export const executeChangesetMain = wrapCommandCtor(ExecuteChangeSet);
export const estimateCost = wrapCommandCtor(EstimateStackCost);

export async function createUpdateChangesetMain(argv: Arguments): Promise<number> {
  argv.changesetType = 'UPDATE';
  return new CreateChangeSet(argv, await loadStackArgs(argv)).run();
};

export async function createCreationChangesetMain(argv: Arguments): Promise<number> {
  argv.changesetType = 'CREATE';
  return new CreateChangeSet(argv, await loadStackArgs(argv)).run();
};

export async function listStacksMain(argv: Arguments): Promise<number> {
  await configureAWS(argv.profile, argv.region);
  await listStacks(argv.tags);
  return 0;
}

export async function watchStackMain(argv: Arguments): Promise<number> {
  await configureAWS(argv.profile, argv.region);
  const region = getCurrentAWSRegion();
  const StackName = argv.stackname;
  const startTime = await getReliableStartTime();

  console.log();
  const stack = await summarizeStackProperties(StackName, region, true);
  const StackId = stack.StackId as string;
  console.log();

  console.log(formatSectionHeading('Previous Stack Events (max 10):'))
  await showStackEvents(StackId, 10);

  console.log();
  await watchStack(StackId, startTime);
  console.log();
  await summarizeCompletedStackOperation(StackId);
  return 0;
}

export async function describeStackMain(argv: Arguments): Promise<number> {
  await configureAWS(argv.profile, argv.region);
  const region = getCurrentAWSRegion();
  const StackName = argv.stackname;

  console.log();
  const stack = await summarizeStackProperties(StackName, region, true);
  const StackId = stack.StackId as string;
  console.log();

  const eventCount = def(50, argv.events);
  console.log(formatSectionHeading(`Previous Stack Events (max ${eventCount}):`))
  await showStackEvents(StackName, eventCount);
  console.log();
  await summarizeCompletedStackOperation(StackId);
  return 0;
}

export async function getStackInstancesMain(argv: Arguments): Promise<number> {
  await configureAWS(argv.profile, argv.region);
  const StackName = argv.stackname;
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
  return 0;
}

export async function getStackTemplateMain(argv: Arguments): Promise<number> {
  await configureAWS(argv.profile, argv.region);

  const StackName = argv.stackname;
  const TemplateStage = def('Original', argv.stage);

  const cfn = new aws.CloudFormation();
  const output = await cfn.getTemplate({StackName, TemplateStage}).promise();
  if (!output.TemplateBody) { // tslint:disable-line
    throw new Error('No template found');
  }
  process.stderr.write(`# Stages Available: ${output.StagesAvailable}\n`);
  process.stderr.write(`# Stage Shown: ${TemplateStage}\n\n`);
  switch (argv.format) {
    case 'yaml':
      if (output.TemplateBody.match(/^ *\{/) !== null) {
        console.log(yaml.dump(JSON.parse(output.TemplateBody)))
      } else {
        console.log(output.TemplateBody);
      }
      break;
    case 'json':
      if (output.TemplateBody.match(/^ *\{/) !== null) {
        console.log(output.TemplateBody);
      } else {
        console.log(JSON.stringify(yaml.loadString(output.TemplateBody, 'cfn'), null, ' '));
      }
      break;
    case 'original':
      console.log(output.TemplateBody);
      break;
    default:
      console.log(output.TemplateBody);
  }

  return 0;
}

export async function deleteStackMain(argv: Arguments): Promise<number> {
  await configureAWS(argv.profile, argv.region);
  const region = getCurrentAWSRegion();

  const StackName = argv.stackname;

  console.log();
  const stack = await summarizeStackProperties(StackName, region, true);
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
    // --retain-resources, --client-request-token
    const startTime = await getReliableStartTime();
    await cfn.deleteStack({StackName, RoleARN: argv.roleArn, RetainResources: argv.retainResources}).promise();
    await watchStack(StackId, startTime);
    console.log();
    const {StackStatus} = await getStackDescription(StackId);
    return showFinalComandSummary(StackStatus === 'DELETE_COMPLETE');
  } else {
    return 1
  }
}
