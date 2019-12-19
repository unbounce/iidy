import * as aws from 'aws-sdk';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as pathmod from 'path';
import {GenericCLIArguments} from '../cli/utils';
import configureAWS from '../configureAWS';
import def from '../default';
import {getKMSAliasForParameter} from '../params';
import {SUCCESS} from '../statusCodes';
import * as yaml from '../yaml';
import {Visitor} from '../preprocess/visitor';
import {getStackDescription} from './getStackDescription';
import {parseTemplateBody} from "./parseTemplateBody";
import {StackArgs} from "./types";

const environmentHandlebarsTmpl = '{{environment}}';

function parameterizeEnv(s0: string, environments = ['development', 'integration', 'staging', 'production']): string {
  let s = s0;
  for (const env of environments) {
    s = s.replace(env, environmentHandlebarsTmpl);
  }
  return s;
}

const createSortWeightsMap = (input: string) =>
  _.fromPairs(_.map(input.trim().split(/$/), (v, i) => [v.trim(), i]));

const parameterSortWeights = createSortWeightsMap(`
Description
Type
MinValue
MaxValue
MinLength
MaxLength`);

const documentSortWeights = createSortWeightsMap(`
AWSTemplateFormatVersion
Description
Parameters
Outputs
Conditions
Resources
Mappings
Metadata
Transform`);

const iamStatementSortWeights = createSortWeightsMap(`
Sid
Effect
Action
Resource
Condition`);

function sortCallback(node0: any, propertyPath: string): any {
  const [parentNode, currentNode] = propertyPath.split('.').slice(-2);

  if (propertyPath === 'root') {
    return sortMapByWeights(node0, documentSortWeights);
  } else if (parentNode === 'Parameters') {
    return sortMapByWeights(node0, parameterSortWeights);
  } else if (parentNode === 'Resources') {
    return sortMapByWeights(node0, {'Type': 0, 'Properties': DEFAULT_SORT_WEIGHT + 1});
  } else if (parentNode === 'Tags') {
    return sortMapByWeights(node0, {'Key': 0, 'Value': 1});
  } else if (parentNode === 'Outputs') {
    return sortMapByWeights(node0, {'Description': 0, 'Value': 1, 'Export': 2});
  } else if (parentNode === 'Statement' && _.isObject(node0)) {
    return sortMapByWeights(node0, iamStatementSortWeights);
  } else if (_.includes(['PolicyDocument', 'AssumeRolePolicyDocument'], currentNode)) {
    return sortMapByWeights(node0, {'Version': 0, 'Statement': 1});
  } else if (parentNode === 'Policies' && _.isObject(node0)) {
    return sortMapByWeights(node0, {'PolicyName': 0, 'PolicyDocument': 1});
  } else {
    return node0;
  }
}

function deepMapValues(object: any, callback: any, propertyPath: any): any {
  if (_.isArray(object)) {
    return _.map(object, deepMapValuesIteratee);
  } else if (object instanceof yaml.Tag) {
    return object.update(deepMapValues(object.data, callback, propertyPath));
  } else if (_.isObject(object) && !_.isDate(object) && !_.isRegExp(object) && !_.isFunction(object)) {
    return _.extend({}, _.mapValues(callback(object, propertyPath), deepMapValuesIteratee));
  } else {
    return callback(object, propertyPath);
  }

  function deepMapValuesIteratee(value: any, key: string) {
    var valuePath = propertyPath ? propertyPath + '.' + key : key;
    return deepMapValues(value, callback, valuePath);
  }
}

const DEFAULT_SORT_WEIGHT = 9999;
function sortMapByWeights(node0: any, weights: any): any {
  let nodePairs: any = _.sortBy(_.toPairs(node0));
  nodePairs = _.sortBy(nodePairs, ([k, _v]) => _.get(weights, k, DEFAULT_SORT_WEIGHT));
  return _.fromPairs(nodePairs);
}

export type ConvertStackArguments = GenericCLIArguments & {
  outputDir: string;
  stackname: string;
  stage?: string;
  sortkeys: boolean;
  project?: string;
  moveParamsToSsm: boolean;
};

export function readTemplateObj(templateBody: string, sortkeys: boolean): Object {
  const templateObj0 = parseTemplateBody(templateBody);
  let templateObj;
  if (sortkeys) {
    templateObj = deepMapValues(templateObj0, sortCallback, 'root');
  } else {
    templateObj = templateObj0;
  }

  const visitor = new Visitor();
  return visitor.visitNode(templateObj, 'Root', {
    GlobalAccumulator: {},
    $envValues: {},
    Stack: []
  });
};

export async function convertStackToIIDY(argv0: GenericCLIArguments): Promise<number> {
  const argv = argv0 as ConvertStackArguments; // NOSONAR
  await configureAWS(argv);
  const outputDir = argv.outputDir;
  const StackName = argv.stackname;
  const TemplateStage = def('Original', argv.stage);

  const cfn = new aws.CloudFormation();
  const {TemplateBody} = await cfn.getTemplate({StackName, TemplateStage}).promise();
  if (!TemplateBody) {
    throw new Error(`Invalid cfn template found for ${StackName}`);
  }

  const templateObj = readTemplateObj(TemplateBody, argv.sortkeys);
  const stack = await getStackDescription(StackName);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  const {StackPolicyBody} = await cfn.getStackPolicy({StackName}).promise();
  let StackPolicy: object;
  if (StackPolicyBody) {
    StackPolicy = JSON.parse(StackPolicyBody);
  } else {
    StackPolicy = {
      "Statement": [
        {
          "Effect": "Allow",
          "Action": "Update:*",
          "Principal": "*",
          "Resource": "*"
        }
      ]
    };
  }
  fs.writeFileSync(pathmod.join(outputDir, 'stack-policy.json'), JSON.stringify(StackPolicy, null, ' '));
  const originalFileExt = (TemplateBody.match(/^ *\{/) !== null) ? 'json' : 'yaml';
  fs.writeFileSync(pathmod.join(outputDir, `_original-template.${originalFileExt}`), TemplateBody);
  fs.writeFileSync(pathmod.join(outputDir, 'cfn-template.yaml'), yaml.dump(templateObj));

  const Tags = _.fromPairs(_.map(stack.Tags, ({Key, Value}) => [Key, Value]));
  const Parameters = _.fromPairs(_.map(stack.Parameters, ({ParameterKey, ParameterValue}) => [ParameterKey, ParameterValue]));
  const project = argv.project || Tags.project;
  Tags.project = '{{project}}';
  const currentEnvironment = Tags.environment || argv.environment;
  const StackNameArg = parameterizeEnv(StackName).replace(/-\d+$/, '-{{build_number}}').replace(project, '{{project}}');
  const stackArgs: StackArgs = {
    Template: './cfn-template.yaml',
    StackName: StackNameArg,
    ApprovedTemplateLocation: undefined,
    Parameters,
    Tags,
    StackPolicy: './stack-policy.json',
    Capabilities: stack.Capabilities,
    TimeoutInMinutes: stack.TimeoutInMinutes,
  };
  if (stack.EnableTerminationProtection) {
    stackArgs.EnableTerminationProtection = true;
  }
  if (!_.isEmpty(stack.NotificationARNs)) {
    stackArgs.NotificationARNs = stack.NotificationARNs;
  }
  if (stack.RoleARN) {
    stackArgs.RoleARN = stack.RoleARN;
  }
  if (stack.DisableRollback) {
    stackArgs.DisableRollback = true;
  }
  if (stackArgs.Tags && stackArgs.Tags.environment) {
    stackArgs.Tags.environment = environmentHandlebarsTmpl;
  }
  if (stackArgs.Tags && stackArgs.Tags.Environment) {
    stackArgs.Tags.Environment = environmentHandlebarsTmpl;
  }
  if (stackArgs.Parameters && stackArgs.Parameters.Environment) {
    stackArgs.Parameters.Environment = environmentHandlebarsTmpl;
  }

  // TODO validate the tags and warn about outdated ones
  const outputDoc = _.merge(
    {
      $defs: {project},
      $imports: {
        build_number: 'env:build_number:0'
      },
    },
    _.omitBy(stackArgs, _.isNil));
  if (argv.moveParamsToSsm) {
    // TODO move this to a separate command that can accomodate different target accounts
    // and possibly writing to multiple environments/accounts
    const ssmPrefix = `/${currentEnvironment}/${project}/`;
    _.set(outputDoc, ['$imports', 'ssmParams'], `ssm-path:/{{environment}}/{{project}}/`);
    const ssm = new aws.SSM();
    const KeyId = await getKMSAliasForParameter(ssmPrefix);
    for (const [key, value] of _.toPairs(stackArgs.Parameters)) {
      if (_.includes(['Environment', 'environment'], key)) {
        continue;
      }
      const Name = `${ssmPrefix}${key}`;
      console.log(`Writing ssm param: ${Name}`)
      const Overwrite = true;
      await ssm.putParameter({Name, Value: value, Type: 'SecureString', KeyId, Overwrite}).promise();
      _.set(outputDoc, ['Parameters', key], new yaml.customTags.$(`ssmParams.${key}`));
    }
  }

  fs.writeFileSync(pathmod.join(outputDir, 'stack-args.yaml'), yaml.dump(outputDoc));
  // TODO write iidy-environment.yaml and related files
  return SUCCESS;
}
