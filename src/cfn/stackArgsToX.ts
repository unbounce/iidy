import * as aws from 'aws-sdk';
import def from '../default';
import {logger} from '../logger';
import objectToCFNParams from './objectToCFNParams';
import objectToCFNTags from './objectToCFNTags';
import {StackArgs} from './types';
import {loadCFNTemplate} from "./loadCFNTemplate";
import {loadCFNStackPolicy} from "./loadCFNStackPolicy";
import {approvedTemplateVersionLocation} from "./approvedTemplateVersionLocation";

export type CFNInputsSupportingUsePreviousValue =
  aws.CloudFormation.CreateChangeSetInput | aws.CloudFormation.UpdateStackInput;

export function _normalizeUsePreviousTemplateOrParamValues(stackArgs: StackArgs, input: CFNInputsSupportingUsePreviousValue): void {
  input.UsePreviousTemplate = stackArgs.UsePreviousTemplate;
  if (stackArgs.UsePreviousParameterValues
    && input.Parameters) {
    stackArgs.UsePreviousParameterValues.forEach((paramName, index) => {
      input.Parameters!.forEach((inputParam, index) => {
        if (inputParam.ParameterKey == paramName) {
          inputParam.UsePreviousValue = true;
          delete inputParam.ParameterValue;
        }
      })
    });
  }
}

export async function stackArgsToCreateStackInput(
  stackArgs: StackArgs, argsFilePath: string, environment: string, stackName?: string)
  : Promise<aws.CloudFormation.CreateStackInput> {
  let templateLocation;
  if (stackArgs.ApprovedTemplateLocation) {
    const approvedLocation = await approvedTemplateVersionLocation(stackArgs.ApprovedTemplateLocation, stackArgs.Template, argsFilePath, environment);
    templateLocation = `https://s3.amazonaws.com/${approvedLocation.Bucket}/${approvedLocation.Key}`;
  }
  else {
    templateLocation = stackArgs.Template;
  }
  // Template is optional for updates and update changesets
  const {TemplateBody, TemplateURL} = await loadCFNTemplate(templateLocation, argsFilePath, environment);
  const {StackPolicyBody, StackPolicyURL} = await loadCFNStackPolicy(stackArgs.StackPolicy, argsFilePath);
  // TODO: DisableRollback
  // specify either DisableRollback or OnFailure, but not both
  const OnFailure = def('ROLLBACK', stackArgs.OnFailure);
  if (stackArgs.ApprovedTemplateLocation) {
    logger.debug(`ApprovedTemplateLocation: ${stackArgs.ApprovedTemplateLocation}`);
    logger.debug(`Original Template: ${stackArgs.Template}`);
    logger.debug(`TemplateURL with ApprovedTemplateLocation: ${TemplateURL}`);
  }
  else {
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

export async function stackArgsToCreateChangeSetInput(
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
  _normalizeUsePreviousTemplateOrParamValues(stackArgs, input);
  input.ChangeSetName = changeSetName;
  input.ClientToken = ClientToken;
  return input;
}

export async function stackArgsToUpdateStackInput(
  stackArgs: StackArgs,
  argsFilePath: string,
  environment: string,
  stackName?: string)
  : Promise<aws.CloudFormation.UpdateStackInput> {
  const input0 = await stackArgsToCreateStackInput(stackArgs, argsFilePath, environment, stackName);
  delete input0.TimeoutInMinutes;
  delete input0.OnFailure;
  const input = input0 as aws.CloudFormation.UpdateStackInput;
  _normalizeUsePreviousTemplateOrParamValues(stackArgs, input);
  return input;
}
