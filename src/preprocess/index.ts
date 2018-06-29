//tslint:disable no-any strict-boolean-expressions
import * as os from 'os';
import * as fs from 'fs';
import * as pathmod from 'path';
import * as process from 'process';
import * as child_process from 'child_process';

import * as _ from 'lodash';
import * as crypto from 'crypto';
import * as handlebars from 'handlebars';

import * as nameGenerator from 'project-name-generator';
import * as escapeStringRegexp from 'escape-string-regexp';


import * as bluebird from 'bluebird';
global.Promise = bluebird;

import * as aws from 'aws-sdk'
import {ServiceConfigurationOptions} from 'aws-sdk/lib/service';
import * as url from 'url';

import * as request from 'request-promise-native';

import * as tv4 from 'tv4';

import * as yaml from '../yaml';
import {logger} from '../logger';
import normalizePath from '../normalizePath';
import filehash from '../filehash';
import paginateAwsCall from '../paginateAwsCall';
import {_getParamsByPath} from '../params';

const HANDLEBARS_RE = /{{(.*?)}}/;
const CFN_SUB_RE = /\${([^!].*?)}/g;

handlebars.registerHelper('tojson', (context: any) => JSON.stringify(context));
handlebars.registerHelper('toyaml', (context: any) => yaml.dump(context));
handlebars.registerHelper('base64', (context: any) => Buffer.from(context).toString('base64'));
handlebars.registerHelper('toLowerCase', (str: string) => str.toLowerCase());
handlebars.registerHelper('toUpperCase', (str: string) => str.toUpperCase());

export function interpolateHandlebarsString(templateString: string, env: object, errorContext: string) {
  try {
    const template = handlebars.compile(templateString, {noEscape: true, strict: true});
    return template(env);
  } catch (e) {
    logger.debug(e);
    throw new Error(
      `Error in string template at ${errorContext}:\n       ${e.message}\n       Template: ${templateString}`)
  }
}

export type SHA256Digest = string;

export type PreprocessOptions = {
  omitMetadata?: boolean
};

export interface CfnDoc {
  AWSTemplateFormatVersion?: '2010-09-09',
  Description?: string,
  Parameters?: object,
  Conditions?: object,
  Resources?: object,
  Outputs?: object,
  Mappings?: object,
  Metadata?: object,
  Transform?: object
};

export type AnyButUndefined = string | number | boolean | object | null | CfnDoc | ExtendedCfnDoc;

export type ImportLocation = string; // | {From: string, As: string}

export type ImportRecord = {
  key: string | null,
  "from": ImportLocation,
  imported: ImportLocation,
  sha256Digest: SHA256Digest,
};

export type $EnvValues = {[key: string]: AnyButUndefined} // TODO might need more general value type

export type $param = {
  Name: string,
  Default?: AnyButUndefined,
  Type?: string,
  Schema?: object,
  AllowedValues?: any[],
  AllowedPattern?: string,
};

// TODO find a better name for this Interface
export interface ExtendedCfnDoc extends CfnDoc {
  $imports?: {[key: string]: any}, // TODO AnyButUndefined
  $defs?: {[key: string]: AnyButUndefined},
  $params?: $param[],
  $location: string,
  $envValues?: $EnvValues
};
const extendedCfnDocKeys = ['$imports', '$defs', '$params', '$location', '$envValues'];

// TODO definition of GlobalSections is a bit ugly. Investigate enum
// alternatives.
const GlobalSections = {
  Parameters: 'Parameters',
  Metadata: 'Metadata',
  Mappings: 'Mappings',
  Conditions: 'Conditions',
  Transform: 'Transform',
  Outputs: 'Outputs',
};
type GlobalSection = keyof typeof GlobalSections;
const GlobalSectionNames = _.values(GlobalSections) as GlobalSection[];

export type StackFrame = {location: string, path: string};
type MaybeStackFrame = {location?: string, path: string};

export type Env = {
  GlobalAccumulator: CfnDoc,
  $envValues: $EnvValues,
  Stack: StackFrame[]
};

export type ImportData = {
  importType?: ImportType
  resolvedLocation: ImportLocation // relative-> absolute, etc.
  data: string
  doc?: any
}

// TODO timestamp
export type ImportType =
  "file" | "env" | "git" | "random" | "filehash" | "filehash-base64" | "cfn" | "ssm" | "ssm-path" | "s3" | "http";
// https://github.com/kimamula/ts-transformer-enumerate is an alternative to this
// repetition. Could also use a keyboard macro.
const importTypes: ImportType[] = [
  "file", "env", "git", "random", "filehash", "filehash-base64", "cfn", "ssm", "ssm-path", "s3", "http"];
const localOnlyImportTypes: ImportType[] = ["file", "env"];

// npm:version npm:project-name, etc. with equivs for lein/mvn
// cfn://stacks/{StackName}/[Outputs,Resources]
// cfn://exports/{ExportName}
// see https://github.com/ampedandwired/bora/blob/master/README.md

type GitValue = "branch" | "describe" | "sha";
const gitValues = ["branch", "describe", "sha"];

function gitValue(valueType: GitValue): string {
  const command = {
    branch: 'git rev-parse --abbrev-ref HEAD',
    describe: 'git describe --dirty --tags',
    sha: 'git rev-parse HEAD'
  }[valueType];

  const result = child_process
    .spawnSync(command, [], {shell: true});
  if (result.status > 0) {
    throw new Error('git value lookup failed. Are you inside a git repo?');
  } else {
    return result.stdout.toString().trim();
  }
}

const sha256Digest = (content: string | Buffer): SHA256Digest =>
  crypto.createHash('sha256').update(content.toString()).digest('hex');

const _isPlainMap = (node: any): node is object =>
  _.isObject(node) &&
  !node.is_yaml_tag &&
  !_.isDate(node) &&
  !_.isRegExp(node) &&
  !_.isFunction(node);

const _flatten = <T>(arrs: T[][]): T[] => [].concat.apply([], arrs);

const _liftKVPairs = (objects: {key: string, value: any}[]) =>
  _.fromPairs(_.map(objects, ({key, value}) => [key, value]))

const mkSubEnv = (env: Env, $envValues: $EnvValues, frame: MaybeStackFrame): Env => {
  const stackFrame = {
    location: frame.location || env.Stack[env.Stack.length - 1].location, // tslint:disable-line
    path: frame.path
  };
  return {
    GlobalAccumulator: env.GlobalAccumulator,
    $envValues,
    Stack: env.Stack.concat([stackFrame])
  };
};

////////////////////////////////////////////////////////////////////////////////
// Import handling

export function parseImportType(location: ImportLocation, baseLocation: ImportLocation): ImportType {
  // TODO splitting by : will probably cause issues on Windows. Do we care?
  const hasExplicitType = location.indexOf(':') > -1;
  const importType0 = hasExplicitType
    ? location.toLowerCase().split(':')[0].replace('https', 'http')
    : "file";
  if (!_.includes(importTypes, importType0)) {
    throw new Error(`Unknown import type ${location} in ${baseLocation}`);
  }
  const importType = importType0 as ImportType;
  const baseImportType = baseLocation.indexOf(':') > -1
    ? baseLocation.toLowerCase().split(':')[0] as ImportType
    : "file";

  if (_.includes(['s3', 'http'], baseImportType)) {
    if (!hasExplicitType) {
      return baseImportType;
    } else if (_.includes(localOnlyImportTypes, importType)) {
      // security cross-check
      throw new Error(`Import type ${location} in ${baseLocation} not allowed from remote template`);
    } else {
      return importType;
    }
  } else {
    return importType;
  }
}

function resolveDocFromImportData(data: string, location: ImportLocation): any {
  const uri = url.parse(location);
  let ext: string;
  if ((uri.host && uri.path)) {
    ext = pathmod.extname(uri.path);
  } else {
    ext = pathmod.extname(location);
  }

  if (_.includes(['.yaml', '.yml'], ext)) {
    return yaml.loadString(data, location)
  } else if (ext === '.json') {
    return JSON.parse(data);
  } else {
    return data;
  }
}

const parseDataFromParamStore = (payload: string, formatType?: string): any => {
  // TODO merge this into resolveDocFromImportData
  if (formatType === 'json') {
    // TODO nicer error reporting
    // `Invalid ssm parameter value ${s} import from ${location} in ${baseLocation}`
    return JSON.parse(payload);
  } else if (formatType === 'yaml') {
    return yaml.loadString(payload, 'location');
  } else {
    return payload
  }
}

export type ImportLoader = (location: ImportLocation, baseLocation: ImportLocation) => Promise<ImportData>;

export const filehashLoader = async (location0: ImportLocation, baseLocation: ImportLocation, format: 'hex' | 'base64' = 'hex') => {
  let location = location0.split(':')[1];
  const allowMissingFile: boolean = location.startsWith('?');
  if (allowMissingFile) {
    location = location.slice(1).trim();
  }
  const resolvedLocation = normalizePath(pathmod.dirname(baseLocation), location);
  if (!fs.existsSync(resolvedLocation)) {
    if (allowMissingFile) {
      return {resolvedLocation, data: 'FILE_MISSING', doc: 'FILE_MISSING'};
    } else {
      throw new Error(`Invalid location ${resolvedLocation} for filehash in ${baseLocation}`);
    }
  } else {
    const data = filehash(resolvedLocation, format);
    return {resolvedLocation, data, doc: data};
  }
};

export const importLoaders: {[key in ImportType]: ImportLoader} = {

  file: async (location, baseLocation) => {
    const resolvedLocation = pathmod.resolve(pathmod.dirname(baseLocation.replace('file:', '')), location.replace('file:', ''));
    try {
      const data = (await bluebird.promisify(fs.readFile)(resolvedLocation)).toString();
      return {resolvedLocation, data, doc: resolveDocFromImportData(data, resolvedLocation)}
    } catch (e) {
      throw new Error(
        `"${baseLocation}" has a bad import "$imports: ... ${location}". ${e}`);
    }
  },

  filehash: filehashLoader, // hex
  "filehash-base64": async (location, baseLocation) => filehashLoader(location, baseLocation, 'base64'),

  s3: async (location, baseLocation) => {
    let resolvedLocation: ImportLocation, format: string;
    if (location.indexOf('s3:') === 0) {
      resolvedLocation = location;
    } else {
      resolvedLocation = 's3:/' + pathmod.join(pathmod.dirname(baseLocation.replace('s3:/', '')), location)
    }
    const uri = url.parse(resolvedLocation);

    if (uri.host && uri.path) {
      const s3 = new aws.S3();
      const s3response = await s3.getObject({
        Bucket: uri.host,
        Key: uri.path.slice(1)  // doesn't like leading /
      }).promise()
      if (s3response.Body) {
        const data = s3response.Body.toString();
        const doc = resolveDocFromImportData(data, resolvedLocation);
        return {importType: 's3', resolvedLocation, data, doc};
      } else {
        throw new Error(`Invalid s3 response from ${location} under ${baseLocation}`);
      }
    }
    throw new Error(`Invalid s3 uri ${location} under ${baseLocation}`);
  },

  cfn: async (location, baseLocation) => {
    let resolvedLocationParts, StackName, field, fieldKey;
    let data: any, doc: any;

    const cfnOptions: ServiceConfigurationOptions = {};
    const uri = url.parse(location);
    const queryParameters = new url.URLSearchParams(uri.search);
    const region = queryParameters.get('region');

    if (region) {
      cfnOptions.region = region;
    }

    const cfn = new aws.CloudFormation(cfnOptions);

    [, field, ...resolvedLocationParts] = location.replace(/\?.*$/, '').split(':');
    const resolvedLocation = resolvedLocationParts.join(':');
    if (field === 'export') {
      const exports0: aws.CloudFormation.Exports = await paginateAwsCall((args) => cfn.listExports(args), {}, 'Exports');
      const exports = _.fromPairs(_.map(exports0, (ex) => [ex.Name, ex]));
      const exportName = resolvedLocation;
      if (exportName) {
        if (!exports[exportName]) {
          throw new Error(`${location} not found`);
        }
        data = exports[exportName];
        doc = data.Value;
      } else {
        data = exports;
        doc = data;
      }
      return {resolvedLocation: location, data, doc};

    } else {
      [StackName, fieldKey] = resolvedLocation.split('/');
      const {Stacks} = await cfn.describeStacks({StackName}).promise();
      if (Stacks && Stacks[0]) {
        const stack = Stacks[0];
        switch (field) {
          case 'output':
            const outputs = _.fromPairs(_.map(stack.Outputs, (output) => [output.OutputKey, output.OutputValue]));
            data = fieldKey ? _.get(outputs, fieldKey) : outputs;
            doc = data;
            break;
          case 'parameter':
            const params = _.fromPairs(_.map(stack.Parameters, (p) => [p.ParameterKey, p.ParameterValue]));
            data = fieldKey ? _.get(params, fieldKey) : params;
            doc = data;
            break;
          case 'tag':
            const tags = _.fromPairs(_.map(stack.Tags, (t) => [t.Key, t.Value]));
            data = fieldKey ? _.get(tags, fieldKey) : tags;
            doc = data;
            break;
          case 'resource':
            const {StackResources} = await cfn.describeStackResources({StackName}).promise();
            const resources = _.fromPairs(_.map(StackResources, (r) => [r.LogicalResourceId, r]));
            data = fieldKey ? _.get(resources, fieldKey) : resources;
            doc = data;
            break;
          case 'stack':
            data = stack
            doc = data;
            break;
          default:
            throw new Error(`Invalid cfn $import: ${location}`);
        }
        return {resolvedLocation: location, data, doc};
      } else {
        throw new Error(`${location} not found`);
      }
    }
  },

  http: async (location, baseLocation) => {
    const resolvedLocation = location;
    const data = await request.get(location);
    const doc = resolveDocFromImportData(data, resolvedLocation);
    return {resolvedLocation, data, doc};
  },

  env: async (location, baseLocation) => {
    let resolvedLocation, defVal;
    [, resolvedLocation, defVal] = location.split(':')
    const data = _.get(process.env, resolvedLocation, defVal)
    if (_.isUndefined(data)) {
      throw new Error(`Env-var ${resolvedLocation} not found from ${baseLocation}`)
    }
    return {resolvedLocation, data, doc: data};
  },

  git: async (location, baseLocation) => {
    const resolvedLocation = location.split(':')[1]
    if (_.includes(gitValues, resolvedLocation)) {
      const data = gitValue(resolvedLocation as GitValue);
      return {resolvedLocation, data, doc: data};
    } else {
      throw new Error(`Invalid git command: ${location}`);
    }
  },

  random: async (location, baseLocation) => {
    const resolvedLocation = location.split(':')[1];
    let data: string;
    if (resolvedLocation === 'dashed-name') {
      data = nameGenerator().dashed;
    } else if (resolvedLocation === 'name') {
      data = nameGenerator().dashed.replace('-', '');
    } else if (resolvedLocation === 'int') {
      const max = 1000, min = 1;
      data = (Math.floor(Math.random() * (max - min)) + min).toString();
    } else {
      throw new Error(`Invalid random type in ${location} at ${baseLocation}`);
    }
    return {resolvedLocation, data, doc: data};
  },

  ssm: async (location, baseLocation) => {
    let resolvedLocation: ImportLocation, format: string;
    [, resolvedLocation, format] = location.split(':')
    const ssm = new aws.SSM();
    const param = await ssm.getParameter({Name: resolvedLocation, WithDecryption: true}).promise()
    if (param.Parameter && param.Parameter.Value) {
      const data = parseDataFromParamStore(param.Parameter.Value, format);
      return {resolvedLocation, data, doc: data};
    } else {
      throw new Error(
        `Invalid ssm parameter ${resolvedLocation} import at ${baseLocation}`);
    }
  },

  "ssm-path": async (location, baseLocation) => {
    let resolvedLocation: ImportLocation, format: string;
    [, resolvedLocation, format] = location.split(':')
    if (!resolvedLocation.endsWith('/')) {
      resolvedLocation += '/';
    }
    const params = await _getParamsByPath(resolvedLocation);
    const doc = _.fromPairs(_.map(params, ({Name, Value}) =>
      [(Name as string).replace(resolvedLocation, ''),
      parseDataFromParamStore(Value as string, format)]));
    return {resolvedLocation, data: JSON.stringify(doc), doc};
  }

};

export async function readFromImportLocation(location: ImportLocation, baseLocation: ImportLocation)
  : Promise<ImportData> {
  // TODO handle relative paths and non-file types
  const importType = parseImportType(location, baseLocation);
  const importData: ImportData = await importLoaders[importType](location, baseLocation);
  return _.merge({importType}, importData);
}

export async function loadImports(
  doc: ExtendedCfnDoc,
  baseLocation: ImportLocation,
  importsAccum: ImportRecord[],
  importLoader = readFromImportLocation  // for mocking in tests
): Promise<void> {
  // recursively load the entire set of imports
  doc.$envValues = doc.$envValues || {};
  if (doc.$defs) {
    for (const key in doc.$defs) {
      if (_.includes(_.keys(doc.$envValues), key)) {
        throw new Error(
          `"${key}" in $defs collides with the same name in $imports of ${baseLocation}`)
      }
      doc.$envValues[key] = doc.$defs[key];
    }
  }
  if (doc.$imports) {

    if (!_.isPlainObject(doc.$imports)) {
      throw Error(
        `Invalid imports in ${baseLocation}:\n "${JSON.stringify(doc.$imports)}". \n Should be mapping.`);
    }

    for (const asKey in doc.$imports) {
      let loc = doc.$imports[asKey];
      if (!_.isString(loc)) {
        throw new Error(`"${baseLocation}" has a bad import "$imports: ... ${asKey}".\n`
          + ` Import values must be strings but ${asKey}=${JSON.stringify(loc, null, ' ')}".`)
      }
      if (loc.search(/{{(.*?)}}/) > -1) {
        loc = interpolateHandlebarsString(loc, doc.$envValues, `${baseLocation}: ${asKey}`);
      }

      logger.debug('loading import:', loc, asKey);
      const importData = await importLoader(loc, baseLocation);
      logger.debug('loaded import:', loc, asKey, importData);
      if (_.isObject(importData.doc)) {
        importData.doc.$location = loc;
      }

      importsAccum.push({
        from: baseLocation,
        imported: importData.resolvedLocation,
        sha256Digest: sha256Digest(importData.data),
        key: asKey
      });

      if (_.includes(doc.$envValues, asKey)) {
        throw new Error(
          `"${asKey}" in $imports collides with the same name in $defs of ${baseLocation}`);
      }
      doc.$envValues[asKey] = importData.doc;
      if (importData.doc.$imports || importData.doc.$defs) {
        await loadImports(
          importData.doc, importData.resolvedLocation, importsAccum, importLoader)
      }
    }
  }
  if (doc.$params) {
    // guard against name clashes
    for (const {Name} of doc.$params) {
      if (_.includes(_.keys(doc.$envValues), Name)) {
        throw new Error(
          `"${Name}" in $params collides with "${Name}" in $imports or $defs of ${baseLocation}`)
      }
    }
  }


};
// End: Import handling
////////////////////////////////////////////////////////////////////////////////


function lookupInEnv(key: string, path: string, env: Env): AnyButUndefined {
  if (typeof key !== 'string') { // tslint:disable-line
    // this is called with the .data attribute of custom yaml tags which might not be
    // strings.
    throw new Error(`Invalid lookup key ${JSON.stringify(key)} at ${path}`)
  }

  const subKeyMatch = key.match(/\[(.*)\] *$/);
  let res: AnyButUndefined;
  if (subKeyMatch) {
    // this is something like !$ firstKey[subKey]
    const subKey: string = lookupInEnv(subKeyMatch[1], path, env) as string;
    const firstKey = key.slice(0, subKeyMatch.index);
    const firstRes: any = lookupInEnv(firstKey, path, env);
    res = firstRes[subKey];
    // TODO test cases for this case
    // TODO support `!$ firstKey[subKey].more` and `!$ firstKey[subKey][more]`
  } else {
    res = env.$envValues[key];
  }
  if (_.isUndefined(res)) {
    logger.debug(`Could not find "${key}" at ${path}}`, env = env)
    throw new Error(`Could not find "${key}" at ${path}}`);
  } else {
    return res;
  }
}

const appendPath = (rootPath: string, suffix: string): string =>
  rootPath ? rootPath + '.' + suffix : suffix;

function mapCustomResourceToGlobalSections(
  resourceDoc: ExtendedCfnDoc,
  path: string,
  env: Env
): void {

  _.forEach(GlobalSectionNames, (section: GlobalSection) => {
    if (resourceDoc[section]) {
      const res = _.merge(
        env.GlobalAccumulator[section], // mutate in place
        _.fromPairs(
          // TOOD is this the right place to be visiting the subsections
          _.map(_.toPairs(visitNode(resourceDoc[section], appendPath(path, section), env)),
            ([k, v]: [string, any]) => {
              const isGlobal = _.has(v, '$global');
              delete v.$global;
              if (isGlobal) {
                // TODO validate that there is no clash with
                // values already in env.GlobalAccumulator
                return [k, v];
              } else {
                return [`${env.$envValues.Prefix}${k}`, v];
              }
            }))
      );
      return res;
    }
  });
}


function validateTemplateParameter(param: $param, mergedParams: any, name: string, env: Env) {
  const paramValue = mergedParams[param.Name];
  if (_.isUndefined(paramValue)) {
    throw new Error(`Missing required parameter ${param.Name} in ${name}`);
  } else if (param.Schema) {
    if (!_.isObject(param.Schema)) {
      throw new Error(`Invalid schema "${param.Name}" in ${name}.`)
    }
    const validationResult = tv4.validateResult(paramValue, param.Schema)
    if (!validationResult.valid) {
      const errmsg = `Parameter validation error for "${param.Name}" in ${name}.`;
      logger.error(errmsg);
      logger.error(`  ${env.Stack[env.Stack.length - 1].location || ''}`)
      logger.error(validationResult.error.message);
      logger.error('Here is the parameter JSON Schema:\n' + yaml.dump(param.Schema));
      throw new Error(errmsg);
    }
  } else if (param.AllowedValues) {
    // cfn style validation
    if (!_.includes(param.AllowedValues, paramValue)) {
      const errmsg = `Parameter validation error for "${param.Name}" in ${name}.`;
      logger.error(errmsg);
      logger.error(`  ${env.Stack[env.Stack.length - 1].location || ''}`)
      logger.error(`${paramValue} not in Allowed Values: ${yaml.dump(param.AllowedValues)}`);
      throw new Error(errmsg);
    }
  } else if (param.AllowedPattern) {
    // TODO test
    const patternRegex = new RegExp(param.AllowedPattern);
    if (!(typeof paramValue === 'string' && paramValue.match(patternRegex))) {
      throw new Error(`Invalid value "${param.Name}" in ${name}. AllowedPattern: ${param.AllowedPattern}.`)
    }
  } else if (typeof param.Type === 'string') {
    const throwParamTypeError = () => {
      throw new Error(`Invalid parameter value "${JSON.stringify(paramValue, null, ' ')}". Expected a ${param.Type}`);
    };
    switch (param.Type) {
      case 'string':
      case 'String':
        if (!_.isString(paramValue)) {
          throwParamTypeError();
        }
        break;
      case 'number':
      case 'Number':
        if (!_.isNumber(paramValue)) {
          throwParamTypeError();
        }
        break;
      case 'object':
      case 'Object':
        if (!_.isObject(paramValue)) {
          throwParamTypeError();
        }
        break;
      // see the full list of AWS CFN params here
      // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/parameters-section-structure.html
      case 'CommaDelimitedList':
      case 'List<Number>':
      case 'AWS::EC2::AvailabilityZone::Name':
      case 'AWS::EC2::Image::Id':
      case 'AWS::EC2::Instance::Id':
      case 'AWS::EC2::KeyPair::KeyName':
      case 'AWS::EC2::SecurityGroup::GroupName':
      case 'AWS::EC2::SecurityGroup::Id':
      case 'AWS::EC2::Subnet::Id':
      case 'AWS::EC2::Volume::Id':
      case 'AWS::EC2::VPC::Id':
      case 'AWS::Route53::HostedZone::Id':
      case 'List<AWS::EC2::AvailabilityZone::Name>':
      case 'List<AWS::EC2::Image::Id>':
      case 'List<AWS::EC2::Instance::Id>':
      case 'List<AWS::EC2::SecurityGroup::GroupName>':
      case 'List<AWS::EC2::SecurityGroup::Id>':
      case 'List<AWS::EC2::Subnet::Id>':
      case 'List<AWS::EC2::Volume::Id>':
      case 'List<AWS::EC2::VPC::Id>':
      case 'List<AWS::Route53::HostedZone::Id>':
      case 'AWS::SSM::Parameter::Name':
      case 'AWS::SSM::Parameter::Value<String>':
      case 'AWS::SSM::Parameter::Value<List<String>>':
      case 'AWS::SSM::Parameter::Value<CommaDelimitedList>':
        // TODO add the rest of the SSM types
        // TODO validate these
        break
      default:
        if (!(param.Type.startsWith('AWS:') || param.Type.startsWith('List<'))) {
          throw new Error(`Unknown parameter type: ${param.Type}`);
        }
    }
  }
}

function visitCustomResource(name: string, resource: any, path: string, env: Env) {
  const template: ExtendedCfnDoc = env.$envValues[resource.Type] as ExtendedCfnDoc;
  if (_.isUndefined(template)) {
    throw new Error(
      `Invalid custom resource type: ${resource.Type} at ${path}: ${JSON.stringify(resource, null, ' ')}`)
  }
  // TODO s/NamePrefix/$namePrefix/
  const prefix = _.isUndefined(resource.NamePrefix) ? name : resource.NamePrefix;
  const stackFrame = {location: template.$location, path: appendPath(path, name)};
  const resourceDoc = _.merge(
    {}, template,
    visitNode(resource.Overrides,
      appendPath(path, `${name}.Overrides`),
      // This is pre template expansion so the names
      // used by $include, etc. must be in scope of the current
      // environment, not in the template's env.
      env));

  // flag any names in the Template that should not be
  // prefixed by visitRef, etc.
  const $globalRefs: {[key: string]: boolean} = {};
  _.forOwn(_.merge({}, resourceDoc.Parameters,
    resourceDoc.Resources,
    resourceDoc.Mappings,
    resourceDoc.Conditions),
    (param, key) => {
      if (param.$global) {
        $globalRefs[key] = true;
      }
    });

  const $paramDefaultsEnv = mkSubEnv(
    env, _.merge({Prefix: prefix}, template.$envValues), stackFrame);

  const $paramDefaults = _.fromPairs(
    _.filter(
      _.map(
        template.$params,
        (v) => [v.Name,
        visitNode(v.Default, appendPath(path, `${name}.$params.${v.Name}`), $paramDefaultsEnv)]),
      ([k, v]) => !_.isUndefined(v)));

  const providedParams = visitNode(resource.Properties, appendPath(path, `${name}.Properties`), env);
  // TODO factor this out:
  // TODO validate providedParams against template.$params[].type json-schema
  // ! 1 find any missing params with no defaults
  // 2 check against AllowedValues and AllowedPattern
  // 3 check min/max Value / Length
  const mergedParams = _.assign({}, $paramDefaults, providedParams);
  _.forEach(template.$params, (param) => validateTemplateParameter(param, mergedParams, name, env));

  const subEnv = mkSubEnv(
    env,
    _.merge(
      {Prefix: prefix, $globalRefs},
      mergedParams,
      template.$envValues),
    stackFrame);

  // TODO consider just visitNode on the entire resourceDoc here
  //      ... that requires finding a way to avoid double processing of .Resources
  const outputResources = visitNode(resourceDoc.Resources, appendPath(path, `${name}.Resources`), subEnv)
  // this will call visitNode on each section as it goes. See above ^
  mapCustomResourceToGlobalSections(resourceDoc, path, subEnv);

  // TODO allow individual output resources to have distinct $namePrefixes
  //    prefix could be a map of resname: prefix
  // Could also add a special char prefix individual resource names and global sections to
  // override this name remapping.
  // This ties in with supporting singleton custom resources that should be shared amongst templates
  return _.map(_.toPairs(outputResources), ([resname, val]: [string, any]) => {
    const isGlobal = _.has(val, '$global');
    delete val.$global;
    if (isGlobal) {
      return [resname, val];
    } else {
      return [`${subEnv.$envValues.Prefix}${resname}`, val];
    }
  });
}

function visitResourceNode(node: any, path: string, env: Env): AnyButUndefined {
  const expanded: {[key: string]: any} = {};
  for (const k in node) {
    if (k.indexOf('$merge') === 0) {
      const sub: any = visitNode(node[k], appendPath(path, k), env);
      for (const k2 in sub) {
        expanded[visitString(k2, path, env)] = sub[k2];
      }
    } else if (_.includes(extendedCfnDocKeys, k)) {
      continue;
    } else {
      expanded[visitString(k, path, env)] = node[k]; // TODO? visitNode(node[k], appendPath(path, k), env);
    }
  }
  return _visitResourceNode(expanded, path, env);
}

// TODO tighten up the return type here: {[key: string]: any}
const _visitResourceNode = (node: object, path: string, env: Env): AnyButUndefined =>
  _.fromPairs(
    _flatten( // as we may output > 1 resource for each template
      _.map(_.toPairs(node), ([name, resource]) => {
        if (_.has(env.$envValues, resource.Type)) {
          return visitCustomResource(name, resource, path, env);
        } else if (resource.Type &&
          (resource.Type.indexOf('AWS') === 0
            || resource.Type.indexOf('Custom') === 0)) {
          return [[name, visitNode(resource, appendPath(path, name), env)]]
        } else {
          throw new Error(
            `Invalid resource type: ${resource.Type} at ${path}: ${JSON.stringify(resource, null, ' ')}`)
        }
      })
    ));

////////////////////////////////////////////////////////////////////////////////


function visitYamlTagNode(node: yaml.Tag, path: string, env: Env): AnyButUndefined {
  if (node instanceof yaml.$include) {
    return visit$include(node, path, env);
  } else if (node instanceof yaml.$expand) {
    return visit$expand(node, path, env);
  } else if (node instanceof yaml.$escape) {
    return visit$escape(node, path, env);
  } else if (node instanceof yaml.$string) {
    return visit$string(node, path, env);
  } else if (node instanceof yaml.$parseYaml) {
    return visit$parseYaml(node, path, env);
  } else if (node instanceof yaml.$if) {
    return visit$if(node, path, env);
  } else if (node instanceof yaml.$eq) {
    return visit$eq(node, path, env);
  } else if (node instanceof yaml.$not) {
    return visit$not(node, path, env);
  } else if (node instanceof yaml.$let) {
    return visit$let(node, path, env);
  } else if (node instanceof yaml.$map) {
    return visit$map(node, path, env);
  } else if (node instanceof yaml.$mapValues) {
    return visit$mapValues(node, path, env);
  } else if (node instanceof yaml.$merge) {
    return visit$merge(node, path, env);
  } else if (node instanceof yaml.$mergeMap) {
    return visit$mergeMap(node, path, env);
  } else if (node instanceof yaml.$concat) {
    return visit$concat(node, path, env);
  } else if (node instanceof yaml.$concatMap) {
    return visit$concatMap(node, path, env);
  } else if (node instanceof yaml.$mapListToHash) {
    return visit$mapListToHash(node, path, env);
  } else if (node instanceof yaml.$groupBy) {
    return visit$groupBy(node, path, env);
  } else if (node instanceof yaml.$fromPairs) {
    return visit$fromPairs(node, path, env);
  } else if (node instanceof yaml.$split) {
    return visit$split(node, path, env);
  } else if (node instanceof yaml.Ref) {
    return visitRef(node, path, env);
  } else if (node instanceof yaml.GetAtt) {
    return visitGetAtt(node, path, env);
  } else if (node instanceof yaml.Sub) {
    return visitSub(node, path, env);
  } else {
    return node.update(visitNode(node.data, path, env));
  }
}

function visit$escape(node: yaml.$escape, path: string, env: Env): AnyButUndefined {
  return node.data;
}

function visit$expand(node: yaml.$expand, path: string, env: Env): AnyButUndefined {
  if (!_.isEqual(_.sortBy(_.keys(node.data)), ['params', 'template'])) {
    // TODO use json schema instead
    throw new Error(`Invalid arguments to $expand: ${_.sortBy(_.keys(node.data))}`);
  } else {
    const {template: templateName, params} = node.data;
    // TODO remove the need for this cast
    const template: ExtendedCfnDoc = _.clone(lookupInEnv(templateName, path, env)) as ExtendedCfnDoc;
    const stackFrame = {location: template.$location, path: appendPath(path, '!$expand')};
    const $paramDefaultsEnv = mkSubEnv(env, _.merge(template.$envValues), stackFrame);
    const $paramDefaults = _.fromPairs(
      _.filter(
        _.map(
          template.$params,
          (v) => [
            v.Name,
            visitNode(v.Default, appendPath(path, `$params.${v.Name}`), $paramDefaultsEnv)]),
        ([k, v]) => !_.isUndefined(v)));
    const providedParams = visitNode(params, appendPath(path, 'params'), env);
    const mergedParams = _.assign({}, $paramDefaults, providedParams);
    _.forEach(template.$params, (param) => validateTemplateParameter(param, mergedParams, '!$expand', env));
    const subEnv = mkSubEnv(env, _.merge({}, mergedParams, template.$envValues), stackFrame);
    delete template.$params;
    // TODO might also need to delete template.$imports, template.$envValues, and template.$defs
    return visitNode(template, path, subEnv);
  }
}

function visit$include(node: yaml.$include, path: string, env: Env): AnyButUndefined {
  if (node.data.indexOf('.') > -1) {
    const reduce: any = _.reduce; // HACK work around broken lodash typedefs
    const lookupRes: any = reduce(node.data.split('.'), (result0: any, subKey: string) => {
      const result = visitNode(result0, path, env); // calling visitNode here fixes issue #75
      // the result0 might contain pre-processor constructs that need evaluation before continuing
      const subEnv = _.isUndefined(result) ? env : mkSubEnv(env, _.merge({}, env.$envValues, result), {path});
      return lookupInEnv(subKey.trim(), path, subEnv);
    }, undefined);
    if (_.isUndefined(lookupRes)) {
      throw new Error(`Could not find ${node.data} at ${path}`);
    } else {
      return visitNode(lookupRes, path, env);
    }
  } else {
    return visitNode(lookupInEnv(node.data, path, env), path, env);
  }
}

function visit$if(node: yaml.$if, path: string, env: Env): AnyButUndefined {
  if (visitNode(node.data.test, path, env)) {
    return visitNode(node.data.then, path, env);
  } else {
    return visitNode(node.data.else, path, env);
  }
}

function visit$eq(node: yaml.$eq, path: string, env: Env): AnyButUndefined {
  return visitNode(node.data[0], path, env) == visitNode(node.data[1], path, env);
}

function visit$not(node: yaml.$not, path: string, env: Env): AnyButUndefined {
  const expr = (_.isArray(node.data) && node.data.length === 1)
    ? node.data[0]
    : node.data;
  return !visitNode(expr, path, env);
}

function visit$let(node: yaml.$let, path: string, env: Env): AnyButUndefined {
  const subEnv = mkSubEnv(
    env,
    _.merge({}, env.$envValues,
      visitNode(_.omit(node.data, ['in']), path, env)),
    {path});
  return visitNode(node.data.in, path, subEnv);
}

function visit$map(node: yaml.$map, path: string, env: Env): AnyButUndefined {
  // TODO validate node.data's shape or even better do this during parsing
  //    template: any, items: [...]
  const {template, items} = node.data
  // TODO handle nested maps
  const varName = node.data.var || 'item';
  const SENTINEL = {};
  const mapped = _.without(_.map(visitNode(node.data.items, path, env), (item0: any, idx: number) => {
    // TODO improve stackFrame details
    const subPath = appendPath(path, idx.toString());
    const item = visitNode(item0, subPath, env); // visit pre expansion
    const subEnv = mkSubEnv(
      env, _.merge({[varName]: item, [varName + 'Idx']: idx}, env.$envValues), {path: subPath});
    if (node.data.filter && !visitNode(node.data.filter, path, subEnv)) {
      return SENTINEL;
    } else {
      return visitNode(template, subPath, subEnv);
    }
  }), SENTINEL);
  return visitNode(mapped, path, env); // TODO do we need to visit again like this?
}

function visit$mapValues(node: yaml.$mapValues, path: string, env: Env): AnyButUndefined {
  const input = visitNode(node.data.items, path, env);
  const keys = visitNode(_.keys(input), path, env);
  const varName = node.data.var || 'item';
  const valuesMap = new yaml.$map({
    items: _.map(input, (value, key) => ({value, key})),
    template: node.data.template,
    'var': varName
  });
  const values = visit$map(valuesMap, path, env);
  return _.fromPairs(_.zip(keys, visitNode(valuesMap, path, env)));
}

function visit$string(node: yaml.$string, path: string, env: Env): string {
  const stringSource = (_.isArray(node.data) && node.data.length === 1)
    ? node.data[0]
    : node.data;
  return yaml.dump(visitNode(stringSource, path, env));
}

function visit$merge(node: yaml.$merge, path: string, env: Env): AnyButUndefined[] {
  const input: any = _.isString(node.data) ? visit$include(new yaml.$include(node.data), path, env) : node.data;
  if (!_.isArray(input) && _.every(input, _.isObject)) {
    throw new Error(`Invalid argument to $merge at "${path}".`
      + " Must be array of arrays.");
  }
  return visitNode(_.merge.apply(_, input), path, env);
}

function visit$mergeMap(node: yaml.$mergeMap, path: string, env: Env): AnyButUndefined {
  return _.merge.apply(_, visitNode(new yaml.$map(node.data), path, env));
}

function visit$concat(node: yaml.$concat, path: string, env: Env): AnyButUndefined[] {
  const error = new Error(`Invalid argument to $concat at "${path}".`
    + " Must be array of arrays.")

  if (!_.isArray(node.data)) {
    throw error;
  }

  const data = _.map(node.data, (d) => visitNode(d, path, env));

  if (!_.every(data, _.isArray)) {
    throw error;
  }

  return _flatten(data);
}

function visit$parseYaml(node: yaml.$parseYaml, path: string, env: Env): AnyButUndefined {
  return visitNode(yaml.loadString(visitString(node.data, path, env), path), path, env);
}

function visit$concatMap(node: yaml.$concatMap, path: string, env: Env): AnyButUndefined {
  return _flatten(visitNode(new yaml.$map(node.data), path, env));
}

function visit$groupBy(node: yaml.$groupBy, path: string, env: Env): AnyButUndefined {
  const varName = node.data.var || 'item';
  const grouped = _.groupBy(visitNode(node.data.items, path, env), (item0) => {
    const item = visitNode(item0, path, env); // visit pre expansion
    const subEnv = mkSubEnv(env, _.merge({}, env.$envValues, {[varName]: item}), {path});
    return visitNode(node.data.key, path, subEnv);
  });

  if (node.data.template) {
    return _.mapValues(
      grouped,
      (items) => _.map(items, (item0) => {
        const item = visitNode(item0, path, env); // visit pre expansion
        const subEnv = mkSubEnv(env, _.merge({}, env.$envValues, {[varName]: item}), {path});
        return visitNode(node.data.template, path, subEnv);
      }));
  } else {
    return grouped;
  }
}

function visit$fromPairs(node: yaml.$fromPairs, path: string, env: Env): AnyButUndefined {
  let input: any = node.data; // TODO tighten this type
  if (input.length === 1 && input[0] instanceof yaml.$include) {
    input = visit$include(input[0], path, env);
  }
  if (input.length > 0 && _.has(input[0], 'Key') && _.has(input[0], 'Value')) {
    input = _.map(input, (i) => ({key: _.get(i, 'Key') as string, value: _.get(i, 'Value')}))
  }
  return visitNode(_liftKVPairs(input), path, env);
}

function visit$split(node: yaml.$split, path: string, env: Env): string[] {
  if (_.isArray(node.data) && node.data.length === 2) {
    const [delimiter, str]: [string, string] = node.data;
    const escapedDelimiter = escapeStringRegexp(delimiter);
    return visitNode(str, path, env)
      .toString()
      .replace(new RegExp(`${escapedDelimiter}+$`), '') // Remove trailing delimiters
      .split(delimiter);
  } else {
    throw new Error(`Invalid argument to $split at "${path}".`
      + " Must be array with two elements: a delimiter to split on and a string to split");
  }
}

function visit$mapListToHash(node: yaml.$mapListToHash, path: string, env: Env): AnyButUndefined {
  return _liftKVPairs(visitNode(new yaml.$map(node.data), path, env));
}

function shouldRewriteRef(ref: string, env: Env) {
  const globalRefs = env.$envValues['$globalRefs'] || {};
  const isGlobal = _.has(globalRefs, ref);
  return env.$envValues.Prefix && !(isGlobal || ref.startsWith('AWS:'));
}

function maybeRewriteRef(ref0: string, path: string, env: Env) {
  const ref = visitNode(ref0, path, env);
  if (shouldRewriteRef(ref.trim().split('.')[0], env)) {
    return `${env.$envValues.Prefix || ''}${ref.trim()}`;
  } else {
    return ref;
  }
}

export const visitRef = (node: yaml.Ref, path: string, env: Env): yaml.Ref =>
  new yaml.Ref(maybeRewriteRef(node.data, path, env));

export const visitGetAtt = (node: yaml.GetAtt, path: string, env: Env): yaml.GetAtt => {
  if (_.isArray(node.data)) {
    const argsArray = _.clone(node.data);
    argsArray[0] = maybeRewriteRef(argsArray[0], path, env);
    return new yaml.GetAtt(argsArray);
  } else { // it's a string
    return new yaml.GetAtt(maybeRewriteRef(node.data, path, env));
  }
}

export function visitSubStringTemplate(template0: string, path: string, env: Env) {
  let template = visitString(template0, path, env);
  if (template.search(CFN_SUB_RE) > -1) {
    template = template.replace(CFN_SUB_RE, (match, g1) => {
      if (shouldRewriteRef(g1.trim().split('.')[0], env)) {
        return `\${${maybeRewriteRef(g1, path, env)}}`
      } else {
        return match;
      }
    });
  }
  return template;
}

export function visitSub(node: yaml.Sub, path: string, env: Env): yaml.Sub {
  if (_.isArray(node.data) && node.data.length === 1) {
    return new yaml.Sub(visitSubStringTemplate(visitNode(node.data[0], path, env), path, env));
  } else if (_.isArray(node.data) && node.data.length === 2) {
    const templateEnv = node.data[1];
    const subEnv = mkSubEnv(
      env, _.merge({}, env.$envValues, {$globalRefs: _.fromPairs(_.map(_.keys(templateEnv), (k) => [k, true]))}),
      {path});
    const template = visitSubStringTemplate(visitNode(node.data[0], path, env), path, subEnv);
    return new yaml.Sub([template, visitNode(templateEnv, path, env)]);
  } else if (_.isString(node.data)) {
    return new yaml.Sub(visitSubStringTemplate(node.data, path, env));
  } else {
    throw new Error(`Invalid arguments to !Sub: ${node.data}`);
  }
}

////////////////////////////////////////////////////////////////////////////////


function visitNode(node: any, path: string, env: Env): any {
  const currNode = path.split('.').pop();
  logger.debug(`entering ${path}:`, {node, nodeType: typeof node, env});
  const result = (() => {
    if (currNode === 'Resources' && path.indexOf('Overrides') === -1) {
      return visitResourceNode(node, path, env);
    } else if (currNode === '$envValues') {
      // filtered out in visitMapNode
      throw new Error(`Shouldn't be able to reach here: ${path}`);
    } else if (node instanceof yaml.Tag) {
      return visitYamlTagNode(node, path, env);
    } else if (_.isArray(node)) {
      return visitArray(node, path, env);
    } else if (_isPlainMap(node)) {
      return visitPlainMap(node, path, env);
    } else if (node instanceof Date) {
      return visitDate(node, path, env);
    } else if (typeof node === 'string') {
      return visitString(node, path, env);
    } else {
      return node;
    }
  })();
  logger.debug(`exiting ${path}:`, {result, node, env});;
  return result;
};

function visitImportedDoc(node: ExtendedCfnDoc, path: string, env: Env): AnyButUndefined {
  // This node comes from a yaml or json document that was imported.
  // We need to resolve/reify all !$ includes fully rather than
  // letting them leak out of the documents $imports: scope and be
  // resolved incorrectly if they're used in other scopes. If we
  // didn't do this any values defined with $defs: in a document that
  // is then imported into other documents would be unresolvable.

  // To achieve this, before calling visitNode on the node
  // itself we visit/resolve all entries in $envValues so the
  // environment we use when visiting the node doesn't have
  // unresolved references in it.

  // TODO add tests to ensure we don't have $! leakage issues in the templates also.
  // TODO tighten the output type

  const stackFrame = {location: node.$location, path: path}; // TODO improve for Root, ...
  const subEnv0 = mkSubEnv(env, node.$envValues || {}, {location: node.$location, path: path});
  const nodeTypes = _.groupBy(_.toPairs(node.$envValues), ([k, v]) => `${_.has(v, '$params')}`);
  const nonTemplates = _.fromPairs(_.get(nodeTypes, 'false'));
  const templates = _.fromPairs(_.get(nodeTypes, 'true'));
  const processedEnvValues = _.merge({}, visitNode(nonTemplates, path, subEnv0), templates);
  const subEnv = mkSubEnv(env, processedEnvValues, stackFrame);
  return visitMapNode(node, path, subEnv);
}

function visitDate(node: Date, path: string, env: Env): Date | string {
  const currNode = path.split('.').pop();
  if (_.includes(['Version', 'AWSTemplateFormatVersion'], currNode)) {
    // common error in cfn / yaml
    return node.toISOString().split('T')[0];
  } else {
    return node;
  }
}

const _isImportedDoc = (node: {}): node is ExtendedCfnDoc =>
  _isPlainMap(node) && _.has(node, '$envValues')

function visitPlainMap(node: {}, path: string, env: Env): AnyButUndefined {
  // TODO tighten node type
  if (_.has(node, '$params')) {
    throw new Error(
      `Templates should be called via !$expand or as CFN resource types: ${path}\n ${yaml.dump(node)}`);
  } else if (_isImportedDoc(node)) {
    return visitImportedDoc(node, path, env);
  } else {
    return visitMapNode(node, path, env);
  }
}


const visitMapNode = (node: any, path: string, env: Env): AnyButUndefined => {
  // without $merge it would just be:
  //return  _.mapValues(node, (v, k) => visitNode(v, appendPath(path, k), env));
  const res: {[key: string]: any} = {};
  for (const k in node) {
    if (k.indexOf('$merge') === 0) {
      const sub: any = visitNode(node[k], appendPath(path, k), env);
      for (const k2 in sub) {
        // mutate in place to acheive a deep merge
        _.merge(res, {[visitString(k2, path, env)]: sub[k2]});
      }
      // TODO handle ref rewriting on the Fn:Ref, Fn:GetAtt type functions
      //} else if ( .. Fn:Ref, etc. ) {
    } else if (_.includes(extendedCfnDocKeys, k)) {
      // we don't want to include things like $imports and $envValues in the output doc
      continue;
    } else {
      res[visitString(k, path, env)] = visitNode(node[k], appendPath(path, k), env);
    }
  }
  return res;
}

const visitArray = (node: AnyButUndefined[], path: string, env: Env): AnyButUndefined[] =>
  _.map(node, (v, i) => visitNode(v, appendPath(path, i.toString()), env));

export function visitString(node: string, path: string, env: Env): string {
  let res: string;
  if (node.search(HANDLEBARS_RE) > -1) {
    res = interpolateHandlebarsString(node, env.$envValues, path);
  } else {
    res = node;
  }
  if (res.match(/^(0\d+)$/)) {
    // this encoding works around non-octal numbers with leading 0s
    // not being quoted by jsyaml.dump which then causes issues with
    // CloudFormation mis-parsing those as octal numbers. The encoding
    // is removed in ../yaml.ts:dump

    // js-yaml devs don't want to change the behaviour so we need this
    // workaround https://github.com/nodeca/js-yaml/issues/394
    res = `$0string ${res}`;
  }
  return res;
}

////////////////////////////////////////////////////////////////////////////////
export function transformPostImports(
  root: ExtendedCfnDoc,
  rootDocLocation: ImportLocation,
  accumulatedImports: ImportRecord[],
  options: PreprocessOptions = {}
): CfnDoc {
  let globalAccum: CfnDoc;
  if (options.omitMetadata) {
    globalAccum = {};
  } else {
    // TODO add the rootDoc to the Imports record
    globalAccum = {
      Metadata: {
        iidy: {
          Host: os.hostname(),
          Imports: accumulatedImports,
          User: os.userInfo().username
        }
      }
    }
  };

  const seedOutput: CfnDoc = {};
  const isCFNDoc = root.AWSTemplateFormatVersion || root.Resources;
  if (isCFNDoc) {
    _.extend(globalAccum,
      {
        Parameters: {},
        Conditions: {},
        Mappings: {},
        Outputs: {}
      });
    seedOutput.AWSTemplateFormatVersion = '2010-09-09';
  }

  const output = _.extend(
    seedOutput,
    visitNode(root, 'Root', {
      GlobalAccumulator: globalAccum,
      $envValues: root.$envValues || {},
      Stack: [{location: rootDocLocation, path: 'Root'}]
    }));

  if (isCFNDoc) {

    // TODO check for secondary cfn docs, or stack dependencies

    _.forEach(
      GlobalSectionNames,
      (sectionName: GlobalSection) => {
        if (!_.isEmpty(globalAccum[sectionName])) {
          output[sectionName] = _.merge({}, output[sectionName], globalAccum[sectionName]);
        }
      });
  }

  // TODO merge/flatten singleton dependencies like shared custom resources
  delete output.$imports;
  delete output.$defs;
  delete output.$envValues;
  return output;
};

export async function transform(
  root0: ExtendedCfnDoc,
  rootDocLocation: ImportLocation,
  options: PreprocessOptions = {},
  importLoader = readFromImportLocation // for mocking in tests
): Promise<CfnDoc> {
  const root = _.clone(root0);
  const accumulatedImports: ImportRecord[] = [];
  await loadImports(root, rootDocLocation, accumulatedImports, importLoader);
  return transformPostImports(root, rootDocLocation, accumulatedImports, options);
};
