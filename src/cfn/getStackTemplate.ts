import * as aws from 'aws-sdk'

import * as yaml from '../yaml';
import def from '../default';
import {SUCCESS} from '../statusCodes';
import {GenericCLIArguments} from '../cli/utils';

import {parseTemplateBody} from "./parseTemplateBody";
import {getStackNameFromArgsAndConfigureAWS} from "./getStackNameFromArgsAndConfigureAWS";

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
