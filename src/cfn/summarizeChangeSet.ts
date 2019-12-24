import * as aws from 'aws-sdk';
import * as cli from 'cli-color';
import * as _ from 'lodash';
import {sprintf} from 'sprintf-js';

import {writeLine} from '../output';
import * as yaml from '../yaml';

export function summarizeChangeSet(changeSet: aws.CloudFormation.DescribeChangeSetOutput) {
  for (const change of changeSet.Changes || []) {
    if (change.ResourceChange) {
      const resourceChange = change.ResourceChange;
      const sprintfTemplate = '  %-17s %-30s %s';
      switch (resourceChange.Action) {
        case 'Add':
          writeLine(sprintf(sprintfTemplate, cli.green('Add'), resourceChange.LogicalResourceId, cli.blackBright(resourceChange.ResourceType)));
          break;
        case 'Remove':
          writeLine(sprintf(
            sprintfTemplate,
            cli.red('Remove'),
            resourceChange.LogicalResourceId,
            cli.blackBright(resourceChange.ResourceType + ' ' + resourceChange.PhysicalResourceId)));
          break;
        case 'Modify':
          if (_.includes(['True', 'Conditional'], resourceChange.Replacement)) {
            writeLine(sprintf(
              sprintfTemplate,
              cli.red('Replace' + (resourceChange.Replacement === 'Conditional' ? '?' : '')),
              resourceChange.LogicalResourceId,
              cli.blackBright(resourceChange.ResourceType + ' ' + resourceChange.PhysicalResourceId)));
          }
          else {
            writeLine(sprintf(sprintfTemplate, cli.yellow('Modify'), resourceChange.LogicalResourceId, cli.yellow(resourceChange.Scope || ''), cli.blackBright(resourceChange.ResourceType + ' ' + resourceChange.PhysicalResourceId)));
          }
          if (resourceChange.Details) {
            writeLine(cli.blackBright(yaml.dump(resourceChange.Details)));
          }
          break;
      }
    }
  }
}
