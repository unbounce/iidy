import * as aws from 'aws-sdk';
import * as cli from 'cli-color';
import * as _ from 'lodash';
import {sprintf} from 'sprintf-js';

import {writeLine, writeRaw} from '../output';
import def from '../default';
import {
  colorizeResourceStatus,
  COLUMN2_START,
  formatLogicalId,
  formatSectionHeading,
  formatStackExportName,
  formatStackOutputName,
  calcPadding
} from './formatting';
import {getAllStackExportsWithImports} from './getAllStackExportsWithImports';
import {getStackDescription} from './getStackDescription';
import {showPendingChangesets} from "./showPendingChangesets";

export async function summarizeStackContents(
  StackId: string,
  stackPromise?: Promise<aws.CloudFormation.Stack>
): Promise<aws.CloudFormation.Stack> {
  // TODO handle this part for when OnFailure=DELETE and stack is gone ...
  //   this would be using a stackId instead
  const cfn = new aws.CloudFormation();
  const resourcesPromise = cfn.describeStackResources({StackName: StackId}).promise();
  const exportsPromise = getAllStackExportsWithImports(StackId);
  const changeSetsPromise = cfn.listChangeSets({StackName: StackId}).promise();
  const stack = await (stackPromise || getStackDescription(StackId));
  const resources = def([], (await resourcesPromise).StackResources);
  // TODO paginate resource lookup ^
  if (resources.length > 0) {
    writeLine(formatSectionHeading('Stack Resources:'));
    const idPadding = calcPadding(resources, r => r.LogicalResourceId);
    const resourceTypePadding = calcPadding(resources, r => r.ResourceType);
    for (const resource of resources) {
      writeLine(
        formatLogicalId(sprintf(` %-${idPadding}s`, resource.LogicalResourceId)),
        cli.blackBright(sprintf(`%-${resourceTypePadding}s`, resource.ResourceType)),
        cli.blackBright(resource.PhysicalResourceId));
    }
  }
  writeLine();
  writeRaw(formatSectionHeading('Stack Outputs:'));
  const outputKeyPadding = calcPadding(stack.Outputs || [], o => o.OutputKey!);
  if (!_.isUndefined(stack.Outputs) && stack.Outputs.length > 0) {
    writeRaw('\n');
    for (const {OutputKey, OutputValue} of stack.Outputs) {
      writeLine(formatStackOutputName(sprintf(` %-${outputKeyPadding}s`, OutputKey)), cli.blackBright(OutputValue));
    }
  }
  else {
    writeLine(' ' + cli.blackBright('None'));
  }
  const exports = await exportsPromise;
  if (exports.length > 0) {
    writeLine();
    writeLine(formatSectionHeading('Stack Exports:'));
    const exportNamePadding = calcPadding(exports, ex => ex.Name!);
    for (const ex of exports) {
      writeLine(formatStackExportName(sprintf(` %-${exportNamePadding}s`, ex.Name)), cli.blackBright(ex.Value));
      // TODO handle NextToken, which might happen on large sets of exports
      const imports = await ex.Imports;
      for (const imp of def([], imports.Imports)) {
        writeLine(cli.blackBright(`  imported by ${imp}`));
      }
    }
  }
  writeLine();
  writeLine(formatSectionHeading(sprintf(`%-${COLUMN2_START}s`, 'Current Stack Status:')),
    colorizeResourceStatus(stack.StackStatus),
    def('', stack.StackStatusReason));
  await showPendingChangesets(StackId, changeSetsPromise);
  return stack;
}
