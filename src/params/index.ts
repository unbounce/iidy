import * as _ from 'lodash';
import * as aws from 'aws-sdk'

import * as jsyaml from 'js-yaml';

import {Arguments} from 'yargs';

import {GlobalArguments} from '../cli';

import configureAWS from '../configureAWS';
import def from '../default';
import paginateAwsCall from '../paginateAwsCall';

async function getAllKMSAliases(): Promise<aws.KMS.AliasList> {
  const kms = new aws.KMS();
  // TODO can't use the following because of .NextMarker
  // return paginateAwsCall(() => kms.listAliases(), null, 'Aliases');

  let res = await kms.listAliases().promise();
  let aliases = def([], res.Aliases);
  while (!_.isUndefined(res.NextMarker)) {
    res = await kms.listAliases({Marker: res.NextMarker}).promise();
    aliases.concat(def([], res.Aliases));
  }
  return aliases;
}

async function getKMSAliasForParameter(paramPath: aws.SSM.ParameterName): Promise<undefined | aws.KMS.AliasNameType> {
  const aliases = _.fromPairs(_.map(await getAllKMSAliases(), (al) => [al.AliasName, al.AliasName]));
  let pathParts = ['alias', 'ssm'].concat(_.filter(paramPath.split('/')));
  while (pathParts.length) {
    const alias = aliases[pathParts.join('/') + '/'] || aliases[pathParts.join('/')];
    if (alias) {
      return alias;
    } else {
      pathParts.pop();
    }
  }
  return undefined;
}

export type SetParamArgs = GlobalArguments & {
  value: string;
  path: string;
  type: 'SecureString' | 'String' | 'StringList';
  overwrite: boolean;
};

export type Format = 'simple' | 'json' | 'yaml';
export type GetParamArgs = GlobalArguments & {path: string, decrypt: boolean, format: Format};

export type GetParamsByPathArgs = GetParamArgs & {recursive: boolean};

export async function setParam(argv: SetParamArgs): Promise<number> {
  await configureAWS(argv.profile, argv.region);

  const Name = argv.path;
  const Value = argv.value.toString();
  const Type = argv.type;
  const Overwrite = argv.overwrite;
  const KeyId = Type === 'SecureString' ? await getKMSAliasForParameter(Name) : undefined;
  const ssm = new aws.SSM();
  const res = await ssm.putParameter({Name, Value, Type, KeyId, Overwrite}).promise();
  return 0;
}

async function getParamTags(path: aws.SSM.ParameterName) {
  const ssm = new aws.SSM();
  return ssm.listTagsForResource({ResourceId: path, ResourceType: 'Parameter'})
    .promise()
    .then((res) => _.fromPairs(_.map(res.TagList, (tag) => [tag.Key, tag.Value])));
}

async function mergeParamTags(param: aws.SSM.Parameter) {
  return _.merge({}, param, {Tags: await getParamTags(param.Name!)});
}

export async function getParam(argv: GetParamArgs): Promise<number> {
  await configureAWS(argv.profile, argv.region);
  const ssm = new aws.SSM();
  const res = await ssm.getParameter({Name: argv.path, WithDecryption: argv.decrypt}).promise();

  if (!res.Parameter) {
    throw new Error('Parameter lookup error');
  } else if (argv.format === 'simple') {
    console.log(res.Parameter!.Value);
  } else {
    const output = await mergeParamTags(res.Parameter);
    if (argv.format === 'json') {
      console.log(JSON.stringify(output, null, ' '));
    } else {
      console.log(jsyaml.dump(output));
    }
  }
  return 0;
}

const paramsToSortedMap = (params: aws.SSM.ParameterList) =>
  _(params)
    .map((param) => [param.Name, param])
    .sort()
    .fromPairs()
    .value();

export async function getParamsByPath(argv: GetParamsByPathArgs): Promise<number> {
  await configureAWS(argv.profile, argv.region);
  const ssm = new aws.SSM();
  const args = {
    Path: argv.path,
    Recursive: argv.recursive,
    WithDecryption: argv.decrypt
  };
  const parameters: aws.SSM.ParameterList = await paginateAwsCall((args) => ssm.getParametersByPath(args), args, 'Parameters');

  if (!parameters) {
    console.log('No parameters found');
    return 1;
  } else if (argv.format === 'simple') {
    console.log(jsyaml.dump(
      _.mapValues(paramsToSortedMap(parameters),
        (param) => param.Value)));
  } else {
    const promises = _.map(parameters, mergeParamTags);
    const taggedParams = paramsToSortedMap(await Promise.all(promises));
    if (argv.format === 'json') {
      console.log(JSON.stringify(taggedParams, null, ' '));
    } else {
      console.log(jsyaml.dump(taggedParams));
    }
  }
  return 0;
}

async function _getParameterHistory(Name: aws.SSM.ParameterName, WithDecryption: boolean): Promise<aws.SSM.ParameterHistoryList> {
  const ssm = new aws.SSM();
  return paginateAwsCall(args => ssm.getParameterHistory(args), {Name, WithDecryption}, 'Parameters');
}

export async function getParamHistory(argv: GetParamArgs): Promise<number> {
  await configureAWS(argv.profile, argv.region);
  const ssm = new aws.SSM();
  const sorted = _.sortBy(await _getParameterHistory(argv.path, argv.decrypt), 'LastModifiedDate')
  const current = sorted[sorted.length - 1];
  const previous = sorted.slice(0, sorted.length - 2);
  if (argv.format === 'simple') {
    console.log(jsyaml.dump({Current: current.Value, Previous: _.map(previous, (param) => param.Value)}));
  } else {
    const output = {
      Current: await mergeParamTags(current),
      Previous: previous
    };
    if (argv.format === 'json') {
      console.log(JSON.stringify(output, null, ' '));
    } else {
      console.log(jsyaml.dump(output));
    }
  }
  return 0;
}
