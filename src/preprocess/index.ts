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
import {Visitor} from './visitor';

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
export type GlobalSection = keyof typeof GlobalSections;
export const GlobalSectionNames = _.values(GlobalSections) as GlobalSection[];

export type StackFrame = {location: string, path: string};
export type MaybeStackFrame = {location?: string, path: string};

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

class ImportError<E extends Error> extends Error {
  constructor(message: string, public location: string, public baseLocation: string, public wrappedError?: E) {
    super(message);
  }
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
    let resolvedLocation: ImportLocation;
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

  cfn: async (location, _baseLocation) => {
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

  http: async (location, _baseLocation) => {
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

  git: async (location, _baseLocation) => {
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
    const param = await ssm.getParameter({Name: resolvedLocation, WithDecryption: true}).promise();
    if (param.Parameter && param.Parameter.Value) {
      const data = parseDataFromParamStore(param.Parameter.Value, format);
        return {resolvedLocation, data, doc: data};
      } else {
        throw new Error(
        `Invalid ssm parameter ${resolvedLocation} import at ${baseLocation}`);
    }
  },

  "ssm-path": async (location, _baseLocation) => {
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
    try {
      const importData: ImportData = await importLoaders[importType](location, baseLocation);
      return _.merge({importType}, importData);
    } catch (error) {
      throw new ImportError(
        error.message || `Invalid import ${location} import at ${baseLocation}`,
        location, baseLocation, error
      );
    }
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


export const appendPath = (rootPath: string, suffix: string): string =>
  rootPath ? rootPath + '.' + suffix : suffix;



export function validateTemplateParameter(param: $param, mergedParams: any, name: string, env: Env) {
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

  const visitor = new Visitor();
  const output = _.extend(
    seedOutput,
    visitor.visitNode(root, 'Root', {
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
