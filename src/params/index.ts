import * as _ from 'lodash';
import * as aws from 'aws-sdk'

import * as jsyaml from 'js-yaml';

import {writeLine} from '../output';
import {GlobalArguments} from '../cli/utils';

import getCurrentAWSRegion from '../getCurrentAWSRegion';
import configureAWS from '../configureAWS';
import def from '../default';
import paginateAwsCall from '../paginateAwsCall';
import {Dictionary} from 'lodash';
import {SUCCESS, FAILURE, INTERRUPT} from '../statusCodes';
import confirmationPrompt from '../confirmationPrompt';

const MESSAGE_TAG = 'iidy:message';

async function getAllKMSAliases(): Promise<aws.KMS.AliasList> {
  const kms = new aws.KMS();
  // TODO can't use the following because of .NextMarker
  // return paginateAwsCall(() => kms.listAliases(), null, 'Aliases');

  let res = await kms.listAliases().promise();
  let aliases = def([], res.Aliases);
  while (!_.isUndefined(res.NextMarker)) {
    res = await kms.listAliases({Marker: res.NextMarker}).promise();
    aliases = aliases.concat(def([], res.Aliases));
  }
  return aliases;
}

export async function getKMSAliasForParameter(paramPath: aws.SSM.ParameterName)
  : Promise<undefined | aws.KMS.AliasNameType> {

  const aliases = _.fromPairs(_.map(await getAllKMSAliases(), (al) => [al.AliasName, al.AliasName]));
  const pathParts = ['alias', 'ssm'].concat(_.filter(paramPath.split('/')));
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
  await ssm.putParameter({Name, Value, Type, KeyId, Overwrite}).promise();

  if (argv.withApproval) {
    const region = getCurrentAWSRegion();
    writeLine('Parameter change is pending approval. Review change with:');
    writeLine(`  iidy --region ${region} param review ${argv.path}`);
  }

  if (argv.message) {
    await setParamTags(ssm, Name, [{Key: MESSAGE_TAG, Value: argv.message}]);
  }

  return SUCCESS;
}

export async function reviewParam(argv: ReviewParamArgs): Promise<number> {
  await configureAWS(argv);
  const ssm = new aws.SSM();
  const Name = argv.path;
  const pendingName = `${Name}.pending`;
  const pendingParam = await maybeFetchParam(ssm, {Name: pendingName, WithDecryption: true});

  if (!_.isUndefined(pendingParam)) {
    const currentParam = await maybeFetchParam(ssm, {Name, WithDecryption: true})
    const pendingTags = await getParamTags(ssm, pendingName);
    const Value = pendingParam.Value || '';
    const currentValue = currentParam ? currentParam.Value : '<not set>';
    const Type = pendingParam.Type || 'SecureString';
    const Overwrite = true;
    const KeyId = Type === 'SecureString' ? await getKMSAliasForParameter(Name) : undefined;

    writeLine(`Current: ${currentValue}`);
    writeLine(`Pending: ${Value}`);
    writeLine('');

    if (pendingTags[MESSAGE_TAG]) {
      writeLine(`Message: ${pendingTags[MESSAGE_TAG]}`);
      writeLine('');
    }

    const confirmed = await confirmationPrompt('Would you like to approve these changes?');
    if (confirmed) {
      await ssm.putParameter({Name, Value, Type, KeyId, Overwrite}).promise();
      await ssm.deleteParameter({Name: pendingName}).promise();

      const tags = _.reduce(pendingTags, (acc: aws.SSM.Tag[], Value, Key) => acc.concat({Key, Value}), []);
      await setParamTags(ssm, Name, tags);
      return SUCCESS;
    } else {
      return INTERRUPT;
    }
  } else {
    writeLine(`There is no pending change for parameter ${argv.path}`);
    return FAILURE;
  }
}

async function maybeFetchParam(ssm: aws.SSM, req: aws.SSM.GetParameterRequest): Promise<aws.SSM.Parameter | undefined> {
  try {
    const res = await ssm.getParameter(req).promise();
    return res && res.Parameter;
  } catch (e) {
    if (e.code && e.code === 'ParameterNotFound') {
      return undefined;
    } else {
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

async function mergeParamTags<T extends aws.SSM.Parameter | aws.SSM.ParameterHistory>(ssm: aws.SSM, param: T) {
  return _.merge({}, param, {Tags: await getParamTags(ssm, param.Name as string)});
}

export async function getParam(argv: GetParamArgs): Promise<number> {
  await configureAWS(argv);
  const ssm = new aws.SSM();
  const res = await ssm.getParameter({Name: argv.path, WithDecryption: argv.decrypt}).promise();

  if (!res.Parameter) {
    throw new Error('Parameter lookup error');
  } else if (argv.format === 'simple') {
    writeLine(res.Parameter!.Value);
  } else {
    const output = await mergeParamTags(ssm, res.Parameter);
    if (argv.format === 'json') {
      writeLine(JSON.stringify(output, null, ' '));
    } else {
      writeLine(jsyaml.dump(output));
    }
  }
  return SUCCESS;
}

const paramsToSortedMap = (params: aws.SSM.ParameterList) =>
  _(params)
    .map((param) => [param.Name, param])
    .sort()
    .fromPairs()
    .value();

const _getParametersByPath = async (ssm: aws.SSM, args: aws.SSM.GetParametersByPathRequest)
  : Promise<aws.SSM.ParameterList> => {
  return await paginateAwsCall(
    args0 => ssm.getParametersByPath(args0),
    args, 'Parameters');
}

export async function _getParamsByPath(Path: string): Promise<aws.SSM.ParameterList> {
  const ssm = new aws.SSM();
  return _getParametersByPath(ssm, {
    Path,
    WithDecryption: true
  });
}

export async function getParamsByPath(argv: GetParamsByPathArgs): Promise<number> {
  await configureAWS(argv);
  const ssm = new aws.SSM();
  const args = {
    Path: argv.path,
    Recursive: argv.recursive,
    WithDecryption: argv.decrypt
  };
  const parameters = await _getParametersByPath(ssm, args);

  if (!parameters) {
    writeLine('No parameters found');
    return FAILURE;
  } else if (argv.format === 'simple') {
    writeLine(jsyaml.dump(
      _.mapValues(paramsToSortedMap(parameters),
        (param) => param.Value)));
  } else {
    const promises = _.map(parameters, (parameter) => mergeParamTags(ssm, parameter));
    const taggedParams = paramsToSortedMap(await Promise.all(promises));
    if (argv.format === 'json') {
      writeLine(JSON.stringify(taggedParams, null, ' '));
    } else {
      writeLine(jsyaml.dump(taggedParams));
    }
  }
  return SUCCESS;
}

async function _getParameterHistory(Name: aws.SSM.ParameterName,
  WithDecryption: boolean): Promise<aws.SSM.ParameterHistoryList> {
  const ssm = new aws.SSM();
  return paginateAwsCall(args0 => ssm.getParameterHistory(args0), {Name, WithDecryption}, 'Parameters');
}

export async function getParamHistory(argv: GetParamArgs): Promise<number> {
  await configureAWS(argv);
  const ssm = new aws.SSM();
  const history = await _getParameterHistory(argv.path, argv.decrypt);
  const sorted = _.sortBy(history, 'LastModifiedDate')
  const current = await mergeParamTags(ssm, sorted[sorted.length - 1]);
  const previous = sorted.slice(0, sorted.length - 1);

  if (argv.format === 'simple') {
    writeLine(jsyaml.dump({
      Current: {
        Value: current.Value,
        LastModifiedDate: current.LastModifiedDate,
        LastModifiedUser: current.LastModifiedUser,
        Message: current.Tags ? current.Tags[MESSAGE_TAG] : ''
      },
      Previous: _.map(previous, (p: aws.SSM.ParameterHistory & {Tags: Dictionary<string>}) => {
        return {
          Value: p.Value,
          LastModifiedDate: p.LastModifiedDate,
          LastModifiedUser: p.LastModifiedUser
        };
      })
    }));
  } else {
    const output = {
      Current: current,
      Previous: previous
    };
    if (argv.format === 'json') {
      writeLine(JSON.stringify(output, null, ' '));
    } else {
      writeLine(jsyaml.dump(output));
    }
  }
  return SUCCESS;
}
