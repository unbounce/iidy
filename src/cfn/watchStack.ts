import * as cli from 'cli-color';
import * as _ from 'lodash';
import calcElapsedSeconds from '../calcElapsedSeconds';
import {GenericCLIArguments} from '../cli/utils';
import getCurrentAWSRegion from '../getCurrentAWSRegion';
import {logger} from '../logger';
import mkSpinner from '../spinner';
import {SUCCESS} from '../statusCodes';
import timeout from '../timeout';
import {DEFAULT_EVENT_POLL_INTERVAL} from './defaults';
import {displayStackEvent} from './displayStackEvent';
import eventIsFromSubstack from './eventIsFromSubstack';
import {formatSectionHeading, calcPadding} from './formatting';
import {getAllStackEvents} from './getAllStackEvents';
import getReliableStartTime from './getReliableStartTime';
import {getStackDescription} from './getStackDescription';
import {getStackNameFromArgsAndConfigureAWS} from "./getStackNameFromArgsAndConfigureAWS";
import {summarizeStackContents} from "./summarizeStackContents";
import {summarizeStackDefinition} from "./summarizeStackDefinition";
import {showStackEvents} from './showStackEvents';
import terminalStackStates from './terminalStackStates';
import calcEventTimings from './calcEventTimings';

export async function watchStack(
  StackName: string, startTime: Date, pollInterval = DEFAULT_EVENT_POLL_INTERVAL, inactivityTimeout = 0) {
  // TODO passthrough of statusPadding
  console.log(formatSectionHeading(`Live Stack Events (${pollInterval}s poll):`))

  // TODO add a timeout for super long stacks
  const seen: {[key: string]: boolean} = {};
  const spinner = mkSpinner();
  // TODO consider doing: const spinnerStart = new Date()
  // to ensure calcElapsedSeconds is accurate in the face of innacurate local clocks
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

  const subStacksToIgnore = new Set<string>();
  while (!DONE) {
    let evs = await getAllStackEvents(StackName, true, subStacksToIgnore);
    const {timeToCompletion} = calcEventTimings(evs);
    const statusPadding = calcPadding(evs, ev => ev.ResourceStatus!);
    for (const ev of evs) {
      if (eventIsFromSubstack(ev) && !seen[ev.EventId]) {
        if (_.includes(terminalStackStates, ev.ResourceStatus) && ev.Timestamp > startTime) {
          subStacksToIgnore.add(ev.PhysicalResourceId as string);
        } else {
          subStacksToIgnore.delete(ev.PhysicalResourceId as string);
        }
      }
      if (ev.Timestamp < startTime) {
        logger.debug('filtering event from past', {ev, startTime});
        seen[ev.EventId] = true
      }
      if (!seen[ev.EventId]) {
        logger.debug('displaying new event', {ev, startTime});
        spinner.stop();
        const seconds = timeToCompletion[ev.EventId];
        displayStackEvent(ev, statusPadding, seconds);
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
  await summarizeStackContents(StackId);
  return SUCCESS;
}
