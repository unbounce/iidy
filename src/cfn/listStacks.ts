import * as _ from 'lodash';
import * as aws from 'aws-sdk'
import * as jmespath from 'jmespath';
import * as cli from 'cli-color';
import {sprintf} from 'sprintf-js';

import configureAWS from '../configureAWS';
import {logger} from '../logger';
import def from '../default';
import mkSpinner from '../spinner';
import {SUCCESS} from '../statusCodes';
import {GenericCLIArguments} from '../cli-util';

import {renderTimestamp, formatTimestamp, prettyFormatTags, calcPadding} from './formatting';
import {colorizeResourceStatus} from "./formatting";

export async function getAllStacks() {
  const cfn = new aws.CloudFormation();
  let res = await cfn.describeStacks().promise();
  let stacks = def([], res.Stacks);
  while (!_.isUndefined(res.NextToken)) {
    res = await cfn.describeStacks({NextToken: res.NextToken}).promise();
    stacks = stacks.concat(def([], res.Stacks));
  }
  return stacks;
}

export async function listStacks(showTags = false, query?: string, tagsFilter?: [string, string][], jmespathFilter?: string) {
  const stacksPromise = getAllStacks();
  const spinner = mkSpinner();
  spinner.start();
  const stacks = _.sortBy(await stacksPromise, (st) => def(st.CreationTime, st.LastUpdatedTime));
  spinner.stop();
  if (stacks.length === 0) {
    console.log('No stacks found');
    return SUCCESS;
  }
  const timePadding = 24;
  const statusPadding = calcPadding(stacks, s => s.StackStatus);
  let filteredStacks: aws.CloudFormation.Stack[];
  if (tagsFilter || jmespathFilter) {
    const predicates = [];
    if (tagsFilter) {
      predicates.push((stack: aws.CloudFormation.Stack) => {
        // OLD TODO support more advanced tag filters like: not-set, any, or in-set
        // ^ jmespathfilter can probably handle that
        const tags = _.fromPairs(_.map(stack.Tags, (tag) => [tag.Key, tag.Value]));
        return _.every(tagsFilter, ([k, v]) => tags[k] === v);
      });
    }
    if (jmespathFilter) {
      predicates.push((stack: aws.CloudFormation.Stack) => {
        const jmespathResult = jmespath.search(stack, jmespathFilter);
        logger.debug(`jmespath filtered: ${stack.StackId} jmespathResult=${jmespathResult}`);
        return !!jmespathResult;
      });
    }
    const combinedPredicate: (stack: aws.CloudFormation.Stack) => boolean = _.overEvery(predicates);
    filteredStacks = _.filter(stacks, combinedPredicate);
  }
  else {
    filteredStacks = stacks;
  }
  if (query) {
    // TODO consider adding in .Resources
    console.log(JSON.stringify(jmespath.search({Stacks: filteredStacks}, query), null, ' '));
    return;
  }
  else {
    console.log(cli.blackBright(`Creation/Update Time, Status, Name${showTags ? ', Tags' : ''}`));
    for (const stack of filteredStacks) {
      const tags = _.fromPairs(_.map(stack.Tags, (tag) => [tag.Key, tag.Value]));
      const lifecyle: string | undefined = tags.lifetime;
      let lifecyleIcon: string = '';
      if (stack.EnableTerminationProtection || lifecyle === 'protected') {
        // NOTE stack.EnableTerminationProtection is undefined for the
        // time-being until an upstream bug is fix by AWS
        lifecyleIcon = '🔒 ';
      }
      else if (lifecyle === 'long') {
        lifecyleIcon = '∞ ';
      }
      else if (lifecyle === 'short') {
        lifecyleIcon = '♺ ';
      }
      const baseStackName = stack.StackName.startsWith('StackSet-')
        ? `${cli.blackBright(stack.StackName)} ${tags.StackSetName || stack.Description || 'Unknown stack set instance'}`
        : stack.StackName;
      let stackName: string;
      if (stack.StackName.includes('production') || tags.environment === 'production') {
        stackName = cli.red(baseStackName);
      }
      else if (stack.StackName.includes('integration') || tags.environment === 'integration') {
        stackName = cli.xterm(75)(baseStackName);
      }
      else if (stack.StackName.includes('development') || tags.environment === 'development') {
        stackName = cli.xterm(194)(baseStackName);
      }
      else {
        stackName = baseStackName;
      }
      process.stdout.write(
        sprintf('%s %s %s %s\n',
          formatTimestamp(sprintf(`%${timePadding}s`, renderTimestamp(def(stack.CreationTime, stack.LastUpdatedTime)))),
          colorizeResourceStatus(stack.StackStatus, statusPadding),
          cli.blackBright(lifecyleIcon) + stackName,
          showTags ? cli.blackBright(prettyFormatTags(stack.Tags)) : ''));
      if (stack.StackStatus.indexOf('FAILED') > -1 && !_.isEmpty(stack.StackStatusReason)) {
        console.log('  ', cli.blackBright(stack.StackStatusReason));
      }
    }
  }
}

export async function listStacksMain(argv: GenericCLIArguments): Promise<number> {
  await configureAWS(argv);
  const tagsFilter: [string, string][] = _.map(argv.tagFilter, (tf: string) => {
    const [key, ...value] = tf.split('=');
    return [key, value.join('=')] as [string, string];
  });
  await listStacks(argv.tags, argv.query, tagsFilter, argv.jmespathFilter);
  return SUCCESS;
}
