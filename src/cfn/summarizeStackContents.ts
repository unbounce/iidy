import * as aws from 'aws-sdk';
import * as cli from 'cli-color';
import * as _ from 'lodash';
import {sprintf} from 'sprintf-js';
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
  const stack = await (stackPromise || getStackDescription(StackId, true));
  const resources = def([], (await resourcesPromise).StackResources);
  // TODO paginate resource lookup ^
  if (resources.length > 0) {
    console.log(formatSectionHeading('Stack Resources:'));
    const idPadding = calcPadding(resources, r => r.LogicalResourceId);
    const resourceTypePadding = calcPadding(resources, r => r.ResourceType);
    for (const resource of resources) {
      console.log(
        formatLogicalId(sprintf(` %-${idPadding}s`, resource.LogicalResourceId)),
        cli.blackBright(sprintf(`%-${resourceTypePadding}s`, resource.ResourceType)),
        cli.blackBright(resource.PhysicalResourceId));
    }
  }
  console.log();
  process.stdout.write(formatSectionHeading('Stack Outputs:'));
  const outputKeyPadding = calcPadding(stack.Outputs || [], o => o.OutputKey!);
  if (!_.isUndefined(stack.Outputs) && stack.Outputs.length > 0) {
    process.stdout.write('\n');
    for (const {OutputKey, OutputValue} of stack.Outputs) {
      console.log(formatStackOutputName(sprintf(` %-${outputKeyPadding}s`, OutputKey)), cli.blackBright(OutputValue));
    }
  }
  else {
    console.log(' ' + cli.blackBright('None'));
  }
  const exports = await exportsPromise;
  if (exports.length > 0) {
    console.log();
    console.log(formatSectionHeading('Stack Exports:'));
    const exportNamePadding = calcPadding(exports, ex => ex.Name!);
    for (const ex of exports) {
      console.log(formatStackExportName(sprintf(` %-${exportNamePadding}s`, ex.Name)), cli.blackBright(ex.Value));
      // TODO handle NextToken, which might happen on large sets of exports
      const imports = await ex.Imports;
      for (const imp of def([], imports.Imports)) {
        console.log(cli.blackBright(`  imported by ${imp}`));
      }
    }
  }
  console.log();
  console.log(formatSectionHeading(sprintf(`%-${COLUMN2_START}s`, 'Current Stack Status:')),
    colorizeResourceStatus(stack.StackStatus),
    def('', stack.StackStatusReason));
  await showPendingChangesets(StackId, changeSetsPromise);
  return stack;
}
