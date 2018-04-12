import * as _ from 'lodash';
import * as aws from 'aws-sdk'
import * as inquirer from 'inquirer';

import * as jsyaml from 'js-yaml';

import {Arguments} from 'yargs';

import {GlobalArguments} from '../cli';

import configureAWS from '../configureAWS';
import def from '../default';
import paginateAwsCall from '../paginateAwsCall';

const MESSAGE_TAG = 'iidy:message';

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

export async function getKMSAliasForParameter(paramPath: aws.SSM.ParameterName): Promise<undefined | aws.KMS.AliasNameType> {
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
  withApproval: boolean;
  message?: string;
};

export type ReviewParamArgs = GlobalArguments & {
  path: string;
};

export type Format = 'simple' | 'json' | 'yaml';
export type GetParamArgs = GlobalArguments & {path: string, decrypt: boolean, format: Format};

export type GetParamsByPathArgs = GetParamArgs & {recursive: boolean};

export async function setParam(argv: SetParamArgs): Promise<number> {
  await configureAWS(argv);
  const ssm = new aws.SSM();

  const Name = argv.withApproval ? `${argv.path}.pending` : argv.path;
  const Value = argv.value.toString();
  const Type = argv.type;
  const Overwrite = argv.overwrite;
  const KeyId = Type === 'SecureString' ? await getKMSAliasForParameter(Name) : undefined;
  const res = await ssm.putParameter({Name, Value, Type, KeyId, Overwrite}).promise();

  if(argv.withApproval) {
    console.log('Parameter change is pending approval. Review change with:');
    console.log(`  iidy --region ${argv.region} param review ${argv.path}`);
  }

  if(argv.message) {
    await setParamTags(ssm, Name, [{Key: MESSAGE_TAG, Value: argv.message}]);
  }

  return 0;
}

export async function reviewParam(argv: ReviewParamArgs): Promise<number> {
  await configureAWS(argv);
  const ssm = new aws.SSM();
  const Name = argv.path;
  const pendingName = `${Name}.pending`;
  const pendingParam = await maybeFetchParam(ssm, {Name: pendingName, WithDecryption: true});

  if(!_.isUndefined(pendingParam)) {
    const currentParam = await maybeFetchParam(ssm, {Name, WithDecryption: true})
    const pendingTags = await getParamTags(ssm, pendingName);
    const Value = pendingParam.Value || '';
    const currentValue = currentParam ? currentParam.Value : '<not set>';
    const Type =  pendingParam.Type || 'SecureString';
    const Overwrite = true;
    const KeyId = Type === 'SecureString' ? await getKMSAliasForParameter(Name) : undefined;

    console.log(`Current: ${currentValue}`);
    console.log(`Pending: ${Value}`);
    console.log('');

    if(pendingTags[MESSAGE_TAG]) {
      console.log(`Message: ${pendingTags[MESSAGE_TAG]}`);
      console.log('');
    }

    const resp = await inquirer.prompt({
      name: 'confirmed',
      type: 'confirm',
      default: false,
      message: 'Would you like to approve these changes?'
    });

    if(resp.confirmed) {
      await ssm.putParameter({Name, Value, Type, KeyId, Overwrite}).promise();
      await ssm.deleteParameter({Name: pendingName}).promise();

      const tags = _.reduce(pendingTags, (acc: aws.SSM.Tag[], Value, Key) => acc.concat({Key, Value}), []);
      await setParamTags(ssm, Name, tags);
      return 0;
    } else {
      return 130;
    }
  } else {
    console.log(`There is no pending change for parameter ${argv.path}`);
    return 1;
  }
}

async function maybeFetchParam(ssm: aws.SSM, req: aws.SSM.GetParameterRequest): Promise<aws.SSM.Parameter|undefined> {
  try {
    const res = await ssm.getParameter(req).promise();
    return res && res.Parameter;
  } catch(e) {
    // Return undefined if parameter does not exist
    if(!(e.code && e.code === 'ParameterNotFound')) {
      throw e;
    }
  }
}

async function setParamTags(ssm: aws.SSM, ResourceId: aws.SSM.ParameterName, Tags: aws.SSM.Tag[]) {
  return ssm.addTagsToResource({
    ResourceId,
    ResourceType: 'Parameter',
    Tags
  }).promise();
}

async function getParamTags(ssm: aws.SSM, path: aws.SSM.ParameterName) {
  return ssm.listTagsForResource({ResourceId: path, ResourceType: 'Parameter'})
    .promise()
    .then((res) => _.fromPairs(_.map(res.TagList, (tag) => [tag.Key, tag.Value])));
}

async function mergeParamTags(ssm: aws.SSM, param: aws.SSM.Parameter) {
  return _.merge({}, param, {Tags: await getParamTags(ssm, param.Name!)});
}

export async function getParam(argv: GetParamArgs): Promise<number> {
  await configureAWS(argv);
  const ssm = new aws.SSM();
  const res = await ssm.getParameter({Name: argv.path, WithDecryption: argv.decrypt}).promise();

  if (!res.Parameter) {
    throw new Error('Parameter lookup error');
  } else if (argv.format === 'simple') {
    console.log(res.Parameter!.Value);
  } else {
    const output = await mergeParamTags(ssm, res.Parameter);
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

export async function _getParamsByPath(Path: string): Promise<aws.SSM.ParameterList> {
  const ssm = new aws.SSM();
  const args = {
    Path,
    WithDecryption: true
  };
  const parameters: aws.SSM.ParameterList = await paginateAwsCall(
    (args) => ssm.getParametersByPath(args), args, 'Parameters');
  return parameters;
}

export async function getParamsByPath(argv: GetParamsByPathArgs): Promise<number> {
  await configureAWS(argv);
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
    const promises = _.map(parameters, (parameter) => mergeParamTags(ssm, parameter));
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
  await configureAWS(argv);
  const ssm = new aws.SSM();
  const sorted = _.sortBy(await _getParameterHistory(argv.path, argv.decrypt), 'LastModifiedDate')
  const current = sorted[sorted.length - 1];
  const previous = sorted.slice(0, sorted.length - 2);
  if (argv.format === 'simple') {
    console.log(jsyaml.dump({Current: current.Value, Previous: _.map(previous, (param) => param.Value)}));
  } else {
    const output = {
      Current: await mergeParamTags(ssm, current),
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
