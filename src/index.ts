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
import * as url from 'url';

import * as request from 'request-promise-native';

import * as tv4 from 'tv4';
import * as dateformat from 'dateformat';

import * as yaml from './yaml';
import {logger} from './logger';

handlebars.registerHelper('json', (context: any) => JSON.stringify(context));
handlebars.registerHelper('yaml', (context: any) => yaml.dump(context));

export type SHA256Digest = string;

const sha256Digest = (content: string | Buffer): SHA256Digest =>
  crypto.createHash('sha256').update(content.toString()).digest('hex');

function resolveHome(path: string) {
    if (path[0] === '~') {
        return pathmod.join(process.env.HOME as string, path.slice(1));
    } else {
      return path;
    }
}

const normalizePath = (...pathSegments: string[]) : string =>
  pathmod.resolve.apply(pathmod, _.map(pathSegments, (path) => resolveHome(path.trim())));

const _isPlainMap = (node: any): boolean =>
  _.isObject(node) && !node.is_yaml_tag && !_.isDate(node) && !_.isRegExp(node) && !_.isFunction(node);

const _flatten = <T>(arrs: T[]) => [].concat.apply([], arrs);

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

export type ImportLocation = string; // | {From: string, As: string}

export type ImportRecord = {
  key: string | null,
  "from": ImportLocation,
  imported: ImportLocation,
  sha256Digest: SHA256Digest,
};

type $envValues = {[key: string]: any} // TODO might need more general value type

type $param = {
  Name: string,
  Default?: any,
  Type?: any,
  Schema?: any,
  AllowedValues?: any[],
  AllowedPattern?: string,
};

// TODO find a better name for this Interface
interface ExtendedCfnDoc extends CfnDoc {
  $imports?: {[key: string]: any},
  $params?: Array<$param>,
  $location: string,
  $envValues?: $envValues
};

const GlobalSections = {
  Parameters: 'Parameters',
  Metadata: 'Metadata',
  Mappings: 'Mappings',
  Conditions: 'Conditions',
  Transform: 'Transform',
  Outputs: 'Outputs',
};
type GlobalSection = keyof typeof GlobalSections;

type StackFrame = {location: string, path: string};
type MaybeStackFrame = {location?: string, path: string};

type Env = {
  GlobalAccumulator: CfnDoc,
  $envValues: $envValues,
  Stack: StackFrame[]
};


const mkSubEnv = (env: Env, $envValues: any, frame: MaybeStackFrame): Env => {
  const stackFrame = {location: frame.location || env.Stack[env.Stack.length-1].location,
                      path: frame.path};
  return {GlobalAccumulator: env.GlobalAccumulator,
          $envValues,
          Stack: env.Stack.concat([stackFrame])};
};

type ImportType = "ssm" | "ssm-path" | "file" | "s3" | "http" | "env" | "git" | "random" | "filehash" | "literal";
// https://github.com/kimamula/ts-transformer-enumerate is an alternative to this
// repetition. Could also use a keyboard macro.
const importTypes: ImportType[] = ["ssm", "ssm-path", "file", "s3", "http", "env", "git", "random", "filehash", "literal"];
const localOnlyImportTypes: ImportType[] = ["file", "env"];

// npm:version npm:project-name, etc. with equivs for lein/mvn
// cfn://stacks/{StackName}/[Outputs,Resources]
// cfn://exports/{ExportName}
// see https://github.com/ampedandwired/bora/blob/master/README.md

type GitValue = "branch" | "describe" | "sha";
const gitValues = ["branch", "describe", "sha"];
function gitValue(valueType: GitValue): string {
  const command = {
    branch:'git rev-parse --abbrev-ref HEAD',
    describe:'git describe --dirty',
    sha:'git rev-parse HEAD'
  }[valueType];

  const result = child_process
    .spawnSync(command, [], {shell: true});
  if (result.status > 0) {
    throw new Error('git value lookup failed. Are you inside a git repo?');
  } else {
    return result.stdout.toString().trim();
  }
}

function parseImportType(location: ImportLocation, baseLocation: ImportLocation): ImportType {
  const hasExplicitType = location.indexOf(':') > -1;
  const importType = hasExplicitType
    ? location.toLowerCase().split(':')[0] as ImportType
    : "file";
  const baseImportType = baseLocation.indexOf(':') > -1
    ? baseLocation.toLowerCase().split(':')[0] as ImportType
    : "file";

  if (_.includes(['s3','http'], baseImportType)) {
    if (! hasExplicitType) {
      return baseImportType;
    } else if (_.includes(localOnlyImportTypes, importType)) {
      // security cross-check
      throw new Error(`Import type ${location} in ${baseLocation} not allowed from remote template`);
    } else {
      return importType;
    }
  } else if (_.includes(importTypes, importType)) {
    return importType;
  } else {
    throw new Error(`Unknown import type ${location} in ${baseLocation}`);
  }
}

type ImportData = {
  importType: ImportType
  resolvedLocation: ImportLocation // relative-> absolute, etc.
  data: string
  doc?: any
}

function resolveDocFromImportData(data: string, location: ImportLocation): any {
  const uri = url.parse(location);
  let ext: string;
  if ((uri.host && uri.path)) {
    ext = pathmod.extname(uri.path);
  } else {
    ext = pathmod.extname(location);
  }

  if (_.includes(['.yaml','.yml'], ext)) {
    return yaml.loadString(data, location)
  } else if (ext === '.json') {
    return JSON.parse(data);
  } else {
    return data;
  }
}

async function readFromImportLocation(location: ImportLocation, baseLocation: ImportLocation): Promise<ImportData> {
  const importType = parseImportType(location, baseLocation);
  let resolvedLocation: ImportLocation, data: string, doc: any;

  // TODO handle relative paths and non-file types
  let format: string;
  const tryParseJson = (s: string) => {
    try {
      return JSON.parse(s);
    } catch (e) {
      throw new Error(
        `Invalid ssm parameter value ${s} import from ${location} in ${baseLocation}`)
    }
  }
  switch (importType) {
  case "ssm":
    const ssm = new aws.SSM();
    [,resolvedLocation, format] = location.split(':')
    const param =
      await ssm.getParameter({Name: resolvedLocation, WithDecryption: true}).promise()
    if (param.Parameter && param.Parameter.Value) {
      data = param.Parameter.Value;
      if (format === 'json') {
        data = tryParseJson(param.Parameter.Value);
      } else {
        data = param.Parameter.Value;
      }
      return {importType, resolvedLocation, data, doc: data}
    } else {
      throw new Error(
        `Invalid ssm parameter ${resolvedLocation} import at ${baseLocation}`);
    }
  case "ssm-path":
    const ssm2 = new aws.SSM();
    [,resolvedLocation, format] = location.split(':')
    const params = await ssm2.getParametersByPath(
      {Path: resolvedLocation, WithDecryption:true}).promise()
    doc = _.fromPairs(_.map(params.Parameters, ({Name, Value})=>
                            [(''+Name).replace(resolvedLocation,''),
                             format === 'json' ? tryParseJson(Value+'') : Value]))
    return {importType, resolvedLocation, data: JSON.stringify(doc), doc}
  case "s3":
    const s3 = new aws.S3();
    if (location.indexOf('s3:') === 0) {
      resolvedLocation = location;
    } else {
      resolvedLocation = 's3:/' + pathmod.join(pathmod.dirname(baseLocation.replace('s3:/', '')), location)
    }
    const uri = url.parse(resolvedLocation)

    if (uri.host && uri.path) {
      const s3response = await s3.getObject({
        Bucket: uri.host,
        Key: uri.path.slice(1)  // doesn't like leading /
      }).promise()
      if (s3response.Body) {
        data = s3response.Body.toString();
        doc = resolveDocFromImportData(data, resolvedLocation);
        return {importType, resolvedLocation, data, doc}
      } else {
        throw new Error(`Invalid s3 response from ${location} under ${baseLocation}`);
      }
    }
    throw new Error(`Invalid s3 uri ${location} under ${baseLocation}`);
  case "http":
    resolvedLocation = location
    data = await request.get(location)
    doc = resolveDocFromImportData(data, resolvedLocation)
    return {importType, resolvedLocation, data, doc}
  case "env":
    let defVal;
    [, resolvedLocation, defVal] = location.split(':')
    data = _.get(process.env, resolvedLocation, defVal)
    if (_.isUndefined(data)) {
      throw new Error(`Env-var ${resolvedLocation} not found from ${baseLocation}`)
    }
    return {importType, resolvedLocation, data, doc: data};
  case "git":
    resolvedLocation = location.split(':')[1]
    if (_.includes(gitValues, resolvedLocation)) {
      data = gitValue(resolvedLocation as GitValue);
      return {importType, resolvedLocation, data, doc: data};
    } else {
      throw new Error(`Invalid git command: ${location}`);
    }
  case "random":
    resolvedLocation = location.split(':')[1]
    if (resolvedLocation === 'dashed-name') {
      data = nameGenerator().dashed;
    } else if (resolvedLocation === 'name') {
      data = nameGenerator().dashed.replace('-','');
    } else if (resolvedLocation === 'int') {
      const max = 1000, min = 1;
      data = (Math.floor(Math.random() * (max - min)) + min).toString();
    } else {
      throw new Error(`Invalid random type in ${location} at ${baseLocation}`);
    }
    return {importType, resolvedLocation, data, doc: data};
  case "filehash":
    resolvedLocation = normalizePath(pathmod.dirname(baseLocation), location.split(':')[1]);
    if (! fs.existsSync(resolvedLocation)) {
      throw new Error(`Invalid location ${resolvedLocation} for filehash in ${baseLocation}`);
    }
    const isDir = fs.lstatSync(resolvedLocation).isDirectory();
    const shasumCommand = 'shasum -p -a 256';
    const hashCommand = isDir
      ? `find ${resolvedLocation} -type f -print0 | xargs -0 ${shasumCommand} | ${shasumCommand}`
      : `${shasumCommand} ${resolvedLocation}`;
    const result = child_process.spawnSync(hashCommand, [], {shell:true});
    data = result.stdout.toString().trim().split(' ')[0]
    return {importType, resolvedLocation, data, doc: data}
  case "literal":
    resolvedLocation = location.split(':')[1]
    data = resolvedLocation;
    doc = data;
    return {importType, resolvedLocation, data, doc}
  case "file":
    resolvedLocation = pathmod.resolve(pathmod.dirname(baseLocation), location);
    data = (await bluebird.promisify(fs.readFile)(resolvedLocation)).toString();
    return {importType, resolvedLocation, data, doc: resolveDocFromImportData(data, resolvedLocation)}
  }
}

async function loadImports(
  doc: ExtendedCfnDoc,
  baseLocation: ImportLocation,
  importsAccum: ImportRecord[]
): Promise<void> {
  // recursively load the entire set of imports
  if (doc.$imports) {

    if ( ! _.isPlainObject(doc.$imports)) {
      throw Error(
        `Invalid imports in ${baseLocation}:\n "${JSON.stringify(doc.$imports)}". \n Should be mapping.`);
    }

    doc.$envValues = {};

    for (const asKey in doc.$imports) {
      let loc = doc.$imports[asKey];
      if (loc.search(/{{(.*?)}}/) > -1) {
        loc = handlebars.compile(loc, {noEscape: true})(doc.$envValues);
      }

      logger.debug('loading import:', loc, asKey);
      let importData = await readFromImportLocation(loc, baseLocation);
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
        throw new Error(`Duplicate import name ${asKey} in ${baseLocation}`);
      }
      doc.$envValues[asKey] = importData.doc;
      if (importData.doc.$imports) {
        await loadImports(
          importData.doc, importData.resolvedLocation, importsAccum)
      }
    }
    if (doc.$params) {
      // guard against name clashes with the imports
      for (const {Name} of doc.$params) {
        if (_.includes(_.keys(doc.$envValues), Name)) {
          throw new Error(
            `Colliding name "${Name}" in $params & $imports of ${baseLocation}`)
        }
      }
    }

  }
};

function lookupInEnv(key: string, path: string, env: Env) {
  if (typeof key !== 'string') {
    throw new Error(`Invalid lookup key ${JSON.stringify(key)} at ${path}`)
  }
  const res = env.$envValues[key];
  if (_.isUndefined(res)) {
    logger.debug(`Could not find "${key}" at ${path}}`, env=env)
    throw new Error(`Could not find "${key}" at ${path}}`);
  } else {
    return res;
  }
}

const appendPath = (rootPath: string, suffix: string) =>
  rootPath ? rootPath + '.' + suffix : suffix;

function mapCustomResourceToGlobalSections(
  resourceDoc: CfnDoc,
  path: string,
  env: Env
): void {
  _.forOwn(GlobalSections, (section: GlobalSection) => {
    if (resourceDoc[section]) {
      const res = _.merge(
        env.GlobalAccumulator[section], // mutate in place
        _.fromPairs(
          // TOOD is this the right place to be visiting the subsections
          _.map(_.toPairs(visitNode(resourceDoc[section], appendPath(path, section), env)),
                ([k, v]) => [`${env.$envValues.Prefix}${k}`, v]))
      );
      return res;
    }
  });
}

const visitMapNode = (node: any, path: string, env: Env): any => {
  // without $merge it would just be:
  //return  _.mapValues(node, (v, k) => visitNode(v, appendPath(path, k), env));
  const res: any = {};
  for (const k in node) {
    if (k.indexOf('$merge') === 0) {
      const sub: any = visitNode(node[k], appendPath(path, k), env);
      for (const k2 in sub) {
        if (_.has(res, k2)) {
          throw new Error(
            `Key "${k2}" is already present and cannot be $merge'd into path "${path}"`);
        }
        res[k2] = sub[k2]; //visitNode(sub[k2], appendPath(path, k2), env);
      }
    } else if (_.includes(['$envValues', '$imports', '$params', '$location'], k)) {
      // TODO test this part more thoroughly
      continue;
    } else {
      res[k] = visitNode(node[k], appendPath(path, k), env);
    }
  }
  return res;
}

const visitArray = (node: any[], path: string, env: Env): any =>
  _.map(node, (v, i) => visitNode(v, appendPath(path, i.toString()), env));

function visitStringNode(node: string, path: string, env: Env): any {
  if (node.search(/{{(.*?)}}/) > -1) {
    return handlebars.compile(node, {noEscape: true})(env.$envValues);
  } else {
    return node;
  }
}

// TODO tighten up the return type here: {[key: string]: any}
const visitResourceNode = (node: object, path: string, env: Env): any =>
  _.fromPairs(
    _flatten( // as we may output > 1 resource for each template
      _.map(_.toPairs(node), ([name, resource]) => {
        const template: ExtendedCfnDoc = env.$envValues[resource.Type];
        if (template) {
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
                      env))

          const $paramDefaultsEnv = mkSubEnv(
            env, _.merge({Prefix: prefix}, template.$envValues), stackFrame);

          const $paramDefaults = _.fromPairs(
            _.filter(
              _.map(
                template.$params,
                (v) => [v.Name,
                        visitNode(v.Default, appendPath(path, `${name}.$params.${v.Name}`), $paramDefaultsEnv)]),
              ([k, v]) => ! _.isUndefined(v)));

          const providedParams = visitNode(resource.Properties, appendPath(path, `${name}.Properties`), env);
          // TODO factor this out:
          // TODO validate providedParams against template.$params[].type json-schema
          // ! 1 find any missing params with no defaults
          // 2 check against AllowedValues and AllowedPattern
          // 3 check min/max Value / Length
          const mergedParams = _.merge({}, $paramDefaults, providedParams);
          _.forEach(template.$params, (param)=> {
            const paramValue = mergedParams[param.Name];
            if (_.isUndefined(paramValue)) {
              logger.error(`Missing required parameter ${param.Name} in ${name}`);
            } else if (param.Schema) {
              if (! _.isObject(param.Schema)) {
                throw new Error(`Invalid schema "${param.Name}" in ${name}.`)
              }
              const validationResult = tv4.validateResult(paramValue, param.Schema)
              if (! validationResult.valid) {
                logger.error(`Parameter validation error for "${param.Name}" in ${name}.`);
                logger.error(`  ${env.Stack[env.Stack.length-1].location || ''}`)
                logger.error(validationResult.error.message);
                logger.error('Here is the parameter JSON Schema:\n'+yaml.dump(param.Schema));
              }
            } else if (param.AllowedValues) {
                // cfn style validation
              if (!_.includes(param.AllowedValues, paramValue)) {
                logger.error(`Parameter validation error for "${param.Name}" in ${name}.`);
                logger.error(`  ${env.Stack[env.Stack.length-1].location || ''}`)
                logger.error(`${paramValue} not in Allowed Values: ${yaml.dump(param.AllowedValues)}`);
              }
            } else if (param.AllowedPattern) {
              // TODO test
              const patternRegex = new RegExp(param.AllowedPattern);
              if (! (typeof paramValue === 'string' && paramValue.match(patternRegex))) {
                throw new Error(`Invalid value "${param.Name}" in ${name}. AllowedPattern: ${param.AllowedPattern}.`)
              }
            }

          })

          const subEnv = mkSubEnv(
            env,
            _.merge(
              {Prefix: prefix},
              $paramDefaults,
              providedParams,
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
          return _.map(_.toPairs(outputResources), ([resname, val]) => [`${subEnv.$envValues.Prefix}${resname}`, val])

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

function visit$Expand(node: yaml.$expand, path: string, env: Env): any {
  if (! _.isEqual(_.sortBy(_.keys(node.data)), [ 'params', 'template' ])) {
    // TODO use json schema instead
    throw new Error(`Invalid arguments to $expand: ${_.sortBy(_.keys(node.data))}`);
  } else {
    const {template: templateName, params} = node.data;
    const template = _.clone(lookupInEnv(templateName, path, env));
    // TODO validate the params
    // TODO expand template.$params defaults
    const subEnv = mkSubEnv(env, _.merge({}, params, env.$envValues), {path});
    delete template.$params;
    return visitNode(template, path, subEnv);
  }
}

function visitYamlTagNode(node: yaml.Tag, path: string, env: Env): any {
  // TODO map, flatten, conditions, hoist
  if (node instanceof yaml.$include) {
    if (node.data.indexOf('.') > -1) {
      const [key, ...selector] = node.data.split('.');
      if (! _.has(env.$envValues, key)) {
        throw new Error(`Could not find "${key}" at ${path}`);
      }
      const lookupRes = _.get(env.$envValues[key], selector);
      if (_.isUndefined(lookupRes)) {
        throw new Error(`Could not find path ${selector} in ${key} at ${path}`);
      } else {
        return visitNode(lookupRes, path, env);
      }
    } else {
      return visitNode(lookupInEnv(node.data, path, env), path, env);
    }
  } else if (node instanceof yaml.$expand) {
    return visit$Expand(node, path, env);
  } else if (node instanceof yaml.$escape) {
    return node.data;
  } else if (node instanceof yaml.$string) {
    const stringSource = (_.isArray(node.data) && node.data.length === 1)
      ? node.data[0]
      : node.data;
    return yaml.dump(visitNode(stringSource, path, env)) ;
  } else if (node instanceof yaml.$parseYaml) {
    return visitNode(yaml.loadString(visitNode(node.data, path, env), path), path, env);
  } else if (node instanceof yaml.$let) {
    const subEnv = mkSubEnv(
      env,
      _.merge({}, visitNode(_.omit(node.data, ['in']), path, env), env.$envValues),
      {path});
    return visitNode(node.data.in, path, subEnv);
  } else if (node instanceof yaml.Ref) {
    // TODO test to verify that this works on top level templates that have no .Prefix
    return new yaml.customTags.Ref(`${env.$envValues.Prefix || ''}${node.data}`);
  } else {
    return node.update(visitNode(node.data, path, env));
  }
}

function visitNode(node: any, path: string, env: Env): any {
  const currNode = path.split('.').pop();
  logger.debug(`entering ${path}:`, {node, nodeType: typeof node, env});
  const result = (() => {
    // switch to a switch statement
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
      // TODO factor this out
      if (node.$params) {
        throw new Error(
          `Templates should be called via !$expand or as CFN resource types: ${path}\n ${yaml.dump(node)}`);
      } else if (node.$envValues) {
        const Stack = path==='Root' ?
          env.Stack :
          env.Stack.concat([{location: node.$location, path: path}]);
        return visitMapNode(node, path, {
          GlobalAccumulator: env.GlobalAccumulator,
          $envValues: node.$envValues,
          Stack});
      } else {
        return visitMapNode(node, path, env);
      }
    } else if (node instanceof Date && _.includes(['Version', 'AWSTemplateFormatVersion'], currNode)) {
      // common error in cfn / yaml
      return node.toISOString().split('T')[0];
    } else if (typeof node === 'string') {
      return visitStringNode(node, path, env);
    } else {
      return node;
    }
  })();
  logger.debug(`exiting ${path}:`, {result, node, env});;
  return result;
};


async function transform(root: ExtendedCfnDoc, rootDocLocation: ImportLocation): Promise<CfnDoc> {
  const isCFNDoc = root.AWSTemplateFormatVersion || root.Resources;
  const accumulatedImports: ImportRecord[] = [];
  await loadImports(root, rootDocLocation, accumulatedImports);
  // TODO add the rootDoc to the Imports record
  const globalAccum: CfnDoc = {
    Metadata: {
      iidy: {
        Host: os.hostname(),
        Imports: accumulatedImports,
        User: os.userInfo().username
      }
    }
  };

  let seedOutput: CfnDoc  = {};
  if (isCFNDoc) {
    _.extend(globalAccum,
             {Parameters: {},
              Conditions: {},
              Mappings: {},
              Outputs: {}});
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

    // TODO check for seconary cfn docs, or stack dependencies

    _.forOwn(
      GlobalSections,
      (sectionName: GlobalSection) => {
        if (! _.isEmpty(globalAccum[sectionName])) {
          output[sectionName] = _.merge({}, output[sectionName], globalAccum[sectionName]);
        }});
  }

  // TODO merge/flatten singleton dependencies like shared custom resources
  delete output.$imports;
  delete output.$envValues;
  return output;
};


//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////


// http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-listing-event-history.html
// CREATE_COMPLETE | CREATE_FAILED | CREATE_IN_PROGRESS | DELETE_COMPLETE | DELETE_FAILED | DELETE_IN_PROGRESS | DELETE_SKIPPED | UPDATE_COMPLETE | UPDATE_FAILED | UPDATE_IN_PROGRESS.

// StackStatus — values include:
// "CREATE_IN_PROGRESS", "CREATE_FAILED", "CREATE_COMPLETE", "ROLLBACK_IN_PROGRESS", "ROLLBACK_FAILED", "ROLLBACK_COMPLETE", "DELETE_IN_PROGRESS", "DELETE_FAILED", "DELETE_COMPLETE", "UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_IN_PROGRESS", "UPDATE_ROLLBACK_FAILED", "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS", "UPDATE_ROLLBACK_COMPLETE", "REVIEW_IN_PROGRESS"

const terminalStackStates = [
  'CREATE_COMPLETE',
  'CREATE_FAILED',
  'ROLLBACK_COMPLETE',
  'ROLLBACK_FAILED',
  'DELETE_COMPLETE',
  'DELETE_FAILED',
  'UPDATE_COMPLETE',
  'UPDATE_FAILED',
  'UPDATE_ROLLBACK_COMPLETE',
  'UPDATE_ROLLBACK_FAILED',
  'REVIEW_IN_PROGRESS'
];

import * as querystring from 'querystring';
import { sprintf } from 'sprintf-js';


import * as cli from 'cli-color';

import {AWSRegion} from './aws-regions';

async function configureAWS(profile?: string, region?: AWSRegion) {
  process.env.AWS_SDK_LOAD_CONFIG = 'true'; // see https://github.com/aws/aws-sdk-js/pull/1391
  const credentials = new aws.SharedIniFileCredentials({profile});
  await credentials.refreshPromise()
  aws.config.credentials = credentials;
  if (region) {
    aws.config.update({region});
  }
}

const DEFAULT_STATUS_PADDING = 26;

function colorizeResourceStatus(status: string, padding=DEFAULT_STATUS_PADDING): string {
  const padded = sprintf(`%-${padding}s`, status)
  switch (status) {
  case 'CREATE_IN_PROGRESS':
    return cli.yellow(padded)
  case 'CREATE_FAILED':
    return cli.red(padded)
  case 'CREATE_COMPLETE':
    return cli.greenBright(padded)
  case 'REVIEW_IN_PROGRESS':
    return cli.yellow(padded);
  case 'ROLLBACK_COMPLETE':
    return cli.green(padded);
  case 'ROLLBACK_FAILED':
    return cli.red(padded);
  case 'ROLLBACK_IN_PROGRESS':
    return cli.yellow(padded)
  case 'DELETE_IN_PROGRESS':
    return cli.yellow(padded)
  case 'DELETE_FAILED':
    return cli.red(padded);
  case 'DELETE_COMPLETE':
    return cli.green(padded)
  case 'UPDATE_COMPLETE':
    return cli.greenBright(padded)
  case 'UPDATE_ROLLBACK_COMPLETE':
    return cli.green(padded)
  case 'UPDATE_ROLLBACK_FAILED':
    return cli.red(padded)
  case 'UPDATE_FAILED':
    return cli.red(padded);
  default:
    return padded;
  }
}

function renderTimestamp(ts: Date) {
  if (false && ts.getDate() == (new Date).getDate()) {
    //return 'TODAY ' + ts.toLocaleTimeString(undefined, {hour12: false});
  } else {
    return dateformat(ts);
  }
}

function displayStackEvent(ev: aws.CloudFormation.StackEvent, statusPadding=DEFAULT_STATUS_PADDING) {
  process.stdout.write(
    // TODO timePadding
    sprintf(
      '%s %s %-40s %s ',
      cli.cyan(sprintf('%24s', renderTimestamp(ev.Timestamp))),
      colorizeResourceStatus(ev.ResourceStatus || '', statusPadding),
      ev.ResourceType,
      sprintf('%-35s', ev.LogicalResourceId),
    ));
  if ((ev.ResourceStatusReason || '').length > 30) {
    process.stdout.write('\n');
  }
  console.log(cli.blackBright(ev.ResourceStatusReason || ''));
}

const objectToCFNTags =
  (obj: object): aws.CloudFormation.Tags =>
  _.map(_.toPairs(obj),
        // TODO handle UsePreviousValue for updates
        ([Key, Value]) => { return {Key, Value} });

const objectToCFNParams =
  (obj: {[key: string]: string}): aws.CloudFormation.Parameters =>
  _.map(_.toPairs(obj),
        // TODO handle UsePreviousValue for updates
        ([ParameterKey, ParameterValue]) => {
          return {ParameterKey, ParameterValue}})

type ExitCode = number;

const timeout = (ms:number) => new Promise(res => setTimeout(res, ms));

async function showStackEvents(StackName: string, limit=10) {
  const cfn = new aws.CloudFormation()
  let evs = (await cfn.describeStackEvents(
    {StackName}).promise()).StackEvents || [];
  evs = _.sortBy(evs, (ev) => ev.Timestamp).slice(Math.max(0, evs.length - limit), evs.length);
  const statusPadding = _.max(_.map(evs, (ev)=> (ev.ResourceStatus as string).length))
  _.forEach(evs, ev => displayStackEvent(ev, statusPadding));
}

async function getAllStackEvents(StackName: string, cfn?: aws.CloudFormation) {
  cfn = cfn || new aws.CloudFormation();
  let res = await cfn.describeStackEvents({StackName}).promise();
  let events = res.StackEvents || [];
  while (res.NextToken) {
    res = await cfn.describeStackEvents({StackName, NextToken: res.NextToken}).promise();
    events = events.concat(res.StackEvents || []);
  }
  return events;
}

async function watchStack(StackName: string, startTime: Date, pollInterval=2) {
  const cfn = new aws.CloudFormation()

  console.log(cli.underline(`Live Stack Events (${pollInterval}s poll):`))

  // TODO add a timeout for super long stacks
  const seen: {[key: string]: boolean} = {};

  let DONE = false;
  while (! DONE) {
    // let evs = (await cfn.describeStackEvents(
    //   {StackName}).promise()).StackEvents || [];
    let evs = await getAllStackEvents(StackName);
    // sort by timestamp
    evs = _.sortBy(evs, (ev)=>ev.Timestamp);

    for (let ev of evs) {
      if (ev.Timestamp < startTime) {
        seen[ev.EventId] = true
      }
      if (!seen[ev.EventId]){
        displayStackEvent(ev);
      }
      seen[ev.EventId] = true
      if (ev.ResourceType === 'AWS::CloudFormation::Stack') {
        if (_.includes(terminalStackStates, ev.ResourceStatus) && ev.Timestamp > startTime) {
          console.log(
            cli.cyan('elapsed seconds:', Math.ceil((+(new Date()) - +(startTime))/1000)));
          DONE = true;
        }
      }
    }
    if (! DONE) {
      await timeout(pollInterval*1000);
    }
  }
}

async function getAllStackExports() {
  const cfn = new aws.CloudFormation();
  let res = await cfn.listExports().promise();
  let exports = res.Exports || [];
  while (res.NextToken) {
    res = await cfn.listExports({NextToken: res.NextToken}).promise();
    exports = exports.concat(res.Exports || []);
  }
  return exports;
}

async function summarizeCompletedStackOperation(StackName: string): Promise<aws.CloudFormation.Stack> {
  // TODO handle this part for when OnFailure=DELETE and stack is gone ...
  //   this would be using a stackId instead
  const cfn = new aws.CloudFormation()
  const stack = ((await cfn.describeStacks({StackName}).promise()).Stacks || [])[0];
  if (_.isUndefined(stack)) {
    throw new Error(`Final call to describeStacks returned no results. Check aws console`);
  }
  console.log(cli.underline('Current Stack Status:'),
              colorizeResourceStatus(stack.StackStatus),
              stack.StackStatusReason || '')

  const resources = (
    (await cfn.describeStackResources({StackName}).promise()
    ).StackResources || []);

  const MAX_PADDING = 60;
  if (resources.length) {
    console.log()
    console.log(cli.underline('Stack Resources:'));
    const idPadding = Math.min(
      _.max(_.map(resources, (r)=> (r.LogicalResourceId as string).length)) as number,
      MAX_PADDING);

    for (const resource of resources) {
      console.log(
        sprintf(`%-${idPadding}s`, resource.LogicalResourceId),
        cli.blackBright(resource.PhysicalResourceId)
      );
    }
  }

  console.log()
  console.log(cli.underline('Stack Outputs:'));
  const outputKeyPadding = Math.min(
    _.max(_.map(stack.Outputs, (output)=> (output.OutputKey as string).length)) as number,
    MAX_PADDING);

  for (let {OutputKey, OutputValue} of (stack.Outputs || [])) {
    console.log(sprintf(`%-${outputKeyPadding}s`, OutputKey),
                cli.blackBright(OutputValue));
  }

  const exports = (await getAllStackExports())
    .filter(ex => ex.ExportingStackId === stack.StackId);

  if (exports.length) {
    console.log()
    console.log(cli.underline('Stack Exports:'));
    const exportNamePadding = Math.min(
      _.max(_.map(exports, (ex)=> (ex.Name as string).length)) as number,
      MAX_PADDING);
    for (const ex of exports) {
      console.log(sprintf(`%-${exportNamePadding}s`, ex.Name),
                  cli.blackBright(ex.Value));
      // handle NextToken
      try {
        let imports = await cfn.listImports({ExportName: ex.Name as string}).promise();
        for (let imp of (imports.Imports || [])) {
          console.log(cli.blackBright(`  imported by ${imp}`));
        }
      } catch (e) {
        logger.debug(e);
      }
    }
  }
  console.log()
  return stack;
}

export type CfnOperation = 'CREATE_STACK' | 'UPDATE_STACK' | 'CREATE_CHANGESET' | 'EXECUTE_CHANGESET' | 'ESTIMATE_COST';

function runCommandSet(commands: string[]) {
  for (let command of commands) {
    console.log('Running command:\n' + cli.blackBright(command))
    const result = child_process.spawnSync(command, [], {shell: true});
    if (result.status > 0) {
      throw new Error('Error running command: ' + command);
    } else {
      // TODO show stderr
      // stream the output line by line rather than waiting
      console.log('Command output: \n'+ cli.blackBright(result.stdout.toString().trim()));
    }
  }
}

async function loadCFNStackPolicy(location: string, baseLocation: string): Promise<{StackPolicyBody?: string, StackPolicyURL?: string}> {
  const shouldRender = (location.trim().indexOf('render:') === 0);
  const importData = await readFromImportLocation(location.trim().replace(/^ *render:/, ''), baseLocation);
  if (!shouldRender && importData.importType === 's3') {
    return {StackPolicyURL: importData.resolvedLocation};
  } else {
    return {StackPolicyBody: shouldRender
            ? yaml.dump(await transform(importData.doc, importData.resolvedLocation))
            : importData.data};
  }
}

const TEMPLATE_MAX_BYTES = 51199
async function loadCFNTemplate(location: string, baseLocation: string): Promise<{TemplateBody?: string, TemplateURL?: string}> {
  const shouldRender = (location.trim().indexOf('render:') === 0);
  const importData = await readFromImportLocation(location.trim().replace(/^ *render:/, ''), baseLocation);
  if (!shouldRender && importData.importType === 's3') {
    return {TemplateURL: importData.resolvedLocation};
  } else {
    const body = shouldRender
      ? yaml.dump(await transform(importData.doc, importData.resolvedLocation))
      : importData.data;
    if (body.length >= TEMPLATE_MAX_BYTES) {
      throw new Error('Your cloudformation template is larger than the max allowed size. '
                      + 'You need to upload it to S3 and reference it from there.')
    }
    return {TemplateBody: body};
  }
}

async function summarizeStackProperties(StackName: string, region: string, showTimes=false) {
  const cfn = new aws.CloudFormation();
  const stack = ((await cfn.describeStacks({StackName}).promise()).Stacks || [])[0];
  if (_.isUndefined(stack)) {
    throw new Error(`${StackName} not found`);
  }
  // cfn.getStackPolicy({StackName})
  console.log(cli.underline('Stack Details:'))
  const printEntry = (label:any, data:any) =>
    process.stdout.write(sprintf('%-17s %s\n', label, data));

  printEntry('Name:', cli.blackBright(stack.StackName));
  printEntry('Status', colorizeResourceStatus(stack.StackStatus));
  printEntry('ARN:', cli.blackBright(stack.StackId));
  printEntry('Capabilities:', cli.blackBright(stack.Capabilities || 'None'));

  printEntry('Tags:', cli.blackBright(prettyFormatTags(stack.Tags)));
  printEntry('DisableRollback:', cli.blackBright(stack.DisableRollback));
  //console.log('Stack OnFailure Mode:', cli.blackBright(OnFailure));
  if (showTimes) {
    printEntry('Creation Time:', cli.blackBright(renderTimestamp(stack.CreationTime)));
    printEntry('Last Update Time:', cli.blackBright(renderTimestamp(stack.CreationTime)));
  }
  printEntry('Timeout In Minutes:', cli.blackBright(stack.TimeoutInMinutes || 'None'));
  printEntry('NotificationARNs:', cli.blackBright(stack.NotificationARNs));
  //printEntry('Stack Policy Source:', cli.blackBright(StackPolicy));
  console.log('Console URL:', '')
  console.log(cli.blackBright(`https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stack/detail?stackId=${querystring.escape(stack.StackId || '')}`));

  const changeSets = (await cfn.listChangeSets({StackName}).promise()).Summaries || [];
  if (changeSets.length) {
    console.log();
    console.log(cli.underline('Pending Changesets:'))
    for (let cs of changeSets) {
      // colorize status
      console.log(cli.cyan(renderTimestamp(cs.CreationTime as Date)),
                  cli.magenta(cs.ChangeSetName),
                  cs.ExecutionStatus,
                  cs.StatusReason || '');
      if (cs.Description) {
        console.log('  ', cli.blackBright(cs.Description))
      }
    }
  }

}

const prettyFormatSmallMap = (map: object): string => {
  let out = '';
  _.forOwn(map, (v, key) => {
    if (out) {
      out += ', ';
    }
    out += key + '=' + v;
  })
  return out;
}

const prettyFormatTags = (tags?: aws.CloudFormation.Tags): string => {
  if (_.isUndefined(tags) || tags.length === 0) {
    return '';
  }
  return prettyFormatSmallMap(_.fromPairs(_.map(tags, (tag)=>[tag.Key, tag.Value])));
}

async function getAllStacks() {
  const cfn = new aws.CloudFormation();
  let res = await cfn.describeStacks().promise();
  let stacks = res.Stacks || [];
  while (res.NextToken) {
    res = await cfn.describeStacks({NextToken: res.NextToken}).promise();
    stacks = stacks.concat(res.Stacks || []);
  }
  return stacks;
}

async function listStacks() {
  let stacks = await getAllStacks();
  stacks = _.sortBy(stacks, (st) => st.LastUpdatedTime || st.CreationTime)
  if (stacks.length === 0) {
    console.log('No stacks found');
    return 0;
  }
  console.log(cli.blackBright('Creation/Update Time, Status, Name, Tags'))
  const timePadding = (stacks[0].CreationTime.getDate() < (new Date).getDate())
    ? 24
    : 11;
  const statusPadding = _.max(_.map(stacks, (ev)=> (ev.StackStatus as string).length))

  for (let stack of stacks) {
    process.stdout.write(
      sprintf('%s %s %s %s\n',
              cli.cyan(
                sprintf(`%${timePadding}s`,
                        renderTimestamp(stack.LastUpdatedTime || stack.CreationTime))),
              colorizeResourceStatus(stack.StackStatus, statusPadding),
              stack.StackName,
              cli.blackBright(prettyFormatTags(stack.Tags))))
    if (stack.StackStatus.indexOf('FAILED') > -1 && stack.StackStatusReason) {
      console.log('  ', cli.blackBright(stack.StackStatusReason))
    }
  }
}


//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
import {Arguments} from 'yargs';


export async function renderMain(argv: Arguments): Promise<number> {
  await configureAWS(argv.profile, argv.region)
  const rootDocLocation = pathmod.resolve(argv.template);
  const content = fs.readFileSync(rootDocLocation);
  const input = yaml.loadString(content, rootDocLocation);
  const outputDoc = await transform(input, rootDocLocation);
  const outputString = yaml.dump(outputDoc);
  if (_.includes(['/dev/stdout', 'stdout'], argv.outfile)) {
    console.log(outputString);
  } else {
    // TODO file exists check and --overwrite
    fs.writeFileSync(argv.outfile, outputString);
  }
  return 0;
};


export type StackArgs = {
  StackName: string
  Template: string
  Region?: AWSRegion
  Profile?: string
  Capabilities?: aws.CloudFormation.Capabilities
  Tags?: {[key: string]: string}
  Parameters?: {[key: string]: string}
  NotificationARNs?: aws.CloudFormation.NotificationARNs
  RoleARN?: string
  TimeoutInMinutes?: number
  OnFailure?: 'ROLLBACK' | 'DELETE' | 'DO_NOTHING'
  StackPolicy?: string,
  ResourceTypes?: string[],

  CommandsBefore?: string[]
}

export async function loadStackArgs(argv: Arguments): Promise<StackArgs> {
  return _loadStackArgs(argv.argsfile, argv.region, argv.profile);
}

export async function _loadStackArgs(argsfile: string, region?: AWSRegion, profile?: string): Promise<StackArgs> {
  let argsdata: any;
  if (!fs.existsSync(argsfile)) {
    throw new Error(`stack args file "${argsfile}" not found`);
  } else if (pathmod.extname(argsfile) === '.json') {
    argsdata = JSON.parse(fs.readFileSync(argsfile).toString());
  } else if (_.includes(['.yaml','.yml'], pathmod.extname(argsfile))) {
    argsdata = yaml.loadString(fs.readFileSync(argsfile), argsfile)
  } else {
    throw new Error(`Invalid stack args file "${argsfile}" extension`);
  }

  // have to do it before the call to transform
  await configureAWS(profile || argsdata.Profile, region || argsdata.Region);


  if (argsdata.CommandsBefore) {
    // TODO improve CLI output of this and think about adding
    // descriptive names to the commands

    // TODO might want to inject ENV vars or handlebars into the
    // commands. Also the AWS_ENV
    console.log(cli.underline('Preflight steps:'))
    console.log('Executing CommandsBefore from argsfile');
    runCommandSet(argsdata.CommandsBefore);
  }
  return await transform(argsdata, argsfile) as StackArgs;
  // ... do the normalization here
};

async function stackArgsToCreateStackInput(stackArgs: StackArgs, argsFilePath: string, stackName?: string)
: Promise<aws.CloudFormation.CreateStackInput> {
  const { TemplateBody, TemplateURL } = await loadCFNTemplate(stackArgs.Template, argsFilePath);

  let StackPolicyBody = undefined, StackPolicyURL = undefined;
  if ( ! _.isUndefined(stackArgs.StackPolicy)) {
    let { StackPolicyBody, StackPolicyURL } = await loadCFNStackPolicy(stackArgs.StackPolicy, argsFilePath);
  }
  // TODO: ClientRequestToken, DisableRollback

  return {
    StackName:         stackName || stackArgs.StackName,
    Capabilities:      stackArgs.Capabilities,
    NotificationARNs:  stackArgs.NotificationARNs,
    RoleARN:           stackArgs.RoleARN,
    OnFailure:         stackArgs.OnFailure || 'ROLLBACK',
    TimeoutInMinutes:  stackArgs.TimeoutInMinutes,
    ResourceTypes:     stackArgs.ResourceTypes,
    Parameters:        objectToCFNParams(stackArgs.Parameters || {}),
    Tags:              objectToCFNTags(stackArgs.Tags || {}),
    TemplateBody,
    TemplateURL,
    StackPolicyBody,
    StackPolicyURL
  };
}

async function stackArgsToUpdateStackInput(stackArgs: StackArgs, argsFilePath: string, stackName?: string)
: Promise<aws.CloudFormation.UpdateStackInput> {
  // TODO: StackPolicyDuringUpdateBody, StackPolicyDuringUpdateURL
  const input0 = await stackArgsToCreateStackInput(stackArgs, argsFilePath, stackName);
  delete input0.TimeoutInMinutes;
  delete input0.OnFailure;
  return input0;
}

async function stackArgsToCreateChangeSetInput(changeSetName: string, stackArgs: StackArgs, argsFilePath: string, stackName?: string)
: Promise<aws.CloudFormation.CreateChangeSetInput> {
  // TODO: ResourceTypes optionally locked down for changeset
  const input0 = await stackArgsToCreateStackInput(stackArgs, argsFilePath, stackName);
  delete input0.TimeoutInMinutes;
  delete input0.OnFailure;
  delete input0.StackPolicyBody;
  delete input0.StackPolicyURL;
  const input = input0 as aws.CloudFormation.CreateChangeSetInput;
  input.ChangeSetName = changeSetName;
  return input;
}

abstract class AbstractCloudFormationStackCommand {
  readonly region: AWSRegion
  readonly profile: string
  readonly stackName: string
  readonly argsfile: string

  protected readonly _cfnOperation: CfnOperation
  protected _startTime: Date
  protected _cfn: aws.CloudFormation
  protected readonly _expectedFinalStackStatus: string[]
  protected readonly _showTimesInSummary: boolean = true;
  protected readonly _showPreviousEvents: boolean = true;
  protected readonly _watchStackEvents: boolean = true;

  constructor(readonly argv: Arguments, readonly stackArgs: StackArgs) {
    this.region    = this.argv.region    || this.stackArgs.Region;
    this.profile   = this.argv.profile   || this.stackArgs.Profile;
    this.stackName = this.argv.stackName || this.stackArgs.StackName;
    this.argsfile = argv.argsfile;
  }

  async _setup() {
    await configureAWS(this.profile, this.region)
    this._cfn = new aws.CloudFormation()
  }

  async _showCommandSummary() {
    console.log(); // blank line
    console.log(cli.underline('Command Metadata:'))
    console.log('Cloudformation operation:', cli.magenta(this._cfnOperation));
    console.log(
      'Command line arguments:',
      cli.blackBright(prettyFormatSmallMap(_.pick(this.argv, ['region','profile', 'argsfile']))));

    console.log('Region:', cli.magenta(this.region));
    if (this.profile) {
      console.log('Profile:', cli.magenta(this.profile));
    }

    const sts = new aws.STS();
    const iamIdent = await sts.getCallerIdentity().promise();
    console.log(
      'Current Account / IAM Arn:',
      cli.magenta(iamIdent.Account),
      '\n',
      cli.magenta(iamIdent.Arn));

    console.log('IAM Service Role:', cli.blackBright(this.stackArgs.RoleARN || 'None'));
    console.log();
  }

  async run(): Promise<number> {
    await this._setup()
    await this._showCommandSummary()
    this._startTime = new Date();
    return this._run()
  }

  async _watchAndSummarize(stackId: string): Promise<number> {
    // Show user all the meta data and stack properties
    // TODO previous related stack, long-lived dependency stack, etc.

    // we use StackId below rather than StackName to be resilient to deletions
    await summarizeStackProperties(stackId, this.region, this._showTimesInSummary);

    if (this._showPreviousEvents) {
      console.log();
      console.log(cli.underline('Previous 10 Stack Events:'))
      await showStackEvents(this.stackName, 10);
    }

    console.log();
    if (this._watchStackEvents) {
      await watchStack(stackId, this._startTime);
    }

    console.log();
    const stack = await summarizeCompletedStackOperation(stackId);

    if (_.includes(this._expectedFinalStackStatus, stack.StackStatus)) {
      console.log(
        cli.underline('Summary:'),
        cli.black(cli.bgGreenBright('Success')),
        '👍')
      return 0;
    } else {
      console.log(
        cli.underline('Summary:'),
        cli.bgRedBright('Failure') + '.',
        'Fix and try again. ',
        '(╯°□°）╯︵ ┻━┻'
      )
      return 1;
    }

  }
  async _run(): Promise<number> {
    throw new Error('Not implemented');
  }
}

class CreateStack extends AbstractCloudFormationStackCommand {
  _cfnOperation: CfnOperation = 'CREATE_STACK'
  _expectedFinalStackStatus = ['CREATE_COMPLETE']
  _showTimesInSummary = false;
  _showPreviousEvents = false;

  async _run() {
    const createStackInput = await stackArgsToCreateStackInput(this.stackArgs, this.argsfile, this.stackName)
    const createStackOutput = await this._cfn.createStack(createStackInput).promise();
    return this._watchAndSummarize(createStackOutput.StackId as string);
  }
}

class UpdateStack extends AbstractCloudFormationStackCommand {
  _cfnOperation: CfnOperation = 'UPDATE_STACK'
  _expectedFinalStackStatus = ['UPDATE_COMPLETE']

  async _run() {
    try {
      const updateStackInput = await stackArgsToUpdateStackInput(this.stackArgs, this.argsfile, this.stackName);
      const updateStackOutput = await this._cfn.updateStack(updateStackInput).promise();
      return this._watchAndSummarize(updateStackOutput.StackId as string);
    } catch (e) {
      if (e.message === 'No updates are to be performed.') {
        logger.info('No changes detected so no stack update needed.');
        return 0;
      } else {
        throw e;
      }
    }
  }
}


class CreateChangeSet extends AbstractCloudFormationStackCommand {
  _cfnOperation: CfnOperation = 'CREATE_CHANGESET'
  _expectedFinalStackStatus = terminalStackStates
  _watchStackEvents = false

  async _run() {
    // TODO remove argv as an arg here. Too general

    const ChangeSetName = this.argv.changesetName; // TODO parameterize
    const createChangeSetInput =
      await stackArgsToCreateChangeSetInput(ChangeSetName, this.stackArgs, this.argsfile, this.stackName);
    const StackName = createChangeSetInput.StackName;
    createChangeSetInput.ChangeSetType = this.argv.changesetType;

    // TODO check for exception: 'ResourceNotReady: Resource is not in the state changeSetCreateComplete'

    const changeSetResult = await this._cfn.createChangeSet(createChangeSetInput).promise();
    // TODO replace this with my own tighter polling
    await this._cfn.waitFor('changeSetCreateComplete', {ChangeSetName, StackName}).promise();
    const changeSet = await this._cfn.describeChangeSet({ChangeSetName, StackName}).promise();
    if (changeSet.Status === 'FAILED') {
      logger.error(changeSet.StatusReason as string);
      logger.info('Deleting changeset.')
      await this._cfn.deleteChangeSet({ChangeSetName, StackName}).promise();
      throw new Error('ChangeSet failed to create');
    }
    console.log(cli.underline('Changeset:'));
    console.log(yaml.dump(changeSet));
    // ... need to branch off here and watch the events on the changeset
    // https://...console.aws.amazon.com/cloudformation/home?region=..#/changeset/detail?changeSetId=..&stackId=..
    console.log(cli.blackBright(
      `https://${this.region}.console.aws.amazon.com/cloudformation/home?region=${this.region}#`
        + `/changeset/detail?stackId=${querystring.escape(changeSet.StackId as string)}&changeSetId=${querystring.escape(changeSet.ChangeSetId as string)}`));


    return this._watchAndSummarize(changeSet.StackId as string);
  }
}


class ExecuteChangeSet extends AbstractCloudFormationStackCommand {
  _cfnOperation: CfnOperation = 'EXECUTE_CHANGESET'
  _expectedFinalStackStatus = ['UPDATE_COMPLETE', 'CREATE_COMPLETE']

  async _run() {
    await this._cfn.executeChangeSet({ChangeSetName: this.argv.changesetName, StackName: this.stackName}).promise();
    return this._watchAndSummarize(this.stackName);
  }
}

class EstimateStackCost extends AbstractCloudFormationStackCommand {
  _cfnOperation: CfnOperation = 'ESTIMATE_COST'

  async _run() {
    const {TemplateBody, TemplateURL, Parameters} =
      await stackArgsToCreateStackInput(this.stackArgs, this.argsfile, this.stackName)
    const estimateResp = await this._cfn.estimateTemplateCost({TemplateBody, TemplateURL, Parameters}).promise();
    console.log('Stack cost estimator: ', estimateResp.Url);
    return 0;
  }
}

const wrapCommandCtor =
  (Ctor: new(argv: Arguments, stackArgs: StackArgs) => AbstractCloudFormationStackCommand) =>
  async function (argv: Arguments): Promise<number> {
    return new Ctor(argv, await loadStackArgs(argv)).run();
  }

export const createStackMain = wrapCommandCtor(CreateStack);
export const updateStackMain = wrapCommandCtor(UpdateStack);
export const executeChangesetMain = wrapCommandCtor(ExecuteChangeSet);
export const estimateCost = wrapCommandCtor(EstimateStackCost);

export async function createUpdateChangesetMain(argv: Arguments): Promise<number> {
  argv.changesetType = 'UPDATE';
  return new CreateChangeSet(argv, await loadStackArgs(argv)).run();
};

export async function createCreationChangesetMain(argv: Arguments): Promise<number> {
  argv.changesetType = 'CREATE';
  return new CreateChangeSet(argv, await loadStackArgs(argv)).run();
};

export async function listStacksMain(argv: Arguments): Promise<number> {
  const profile =  argv.profile;
  const region =  argv.region;
  await configureAWS(profile, region);
  await listStacks();
  return 0;
}

export async function watchStackMain(argv: Arguments): Promise<number> {
  const region = argv.region;
  await configureAWS(argv.profile, region);

  const StackName = argv.stackname;
  const startTime = new Date();

  console.log();
  await summarizeStackProperties(StackName, region, true);
  console.log();

  console.log(cli.underline('Previous 10 Stack Events:'))
  await showStackEvents(StackName, 10);

  console.log();
  await watchStack(StackName, startTime);
  console.log();
  await summarizeCompletedStackOperation(StackName);
  return 0;
}

export async function describeStackMain(argv: Arguments): Promise<number> {
  const region = argv.region;
  await configureAWS(argv.profile, argv.region);

  const StackName = argv.stackname;

  console.log();
  await summarizeStackProperties(StackName, region, true);
  console.log();

  const eventCount = argv.events || 50;
  console.log(cli.underline(`Previous ${eventCount} Stack Events:`))
  await showStackEvents(StackName, eventCount);
  console.log();
  await summarizeCompletedStackOperation(StackName);
  return 0;
}

export async function getStackTemplateMain(argv: Arguments): Promise<number> {
  const region = argv.region;
  await configureAWS(argv.profile, argv.region);

  const StackName = argv.stackname;
  const TemplateStage = argv.stage || 'Original';

  const cfn = new aws.CloudFormation();
  const output = await cfn.getTemplate({StackName, TemplateStage}).promise();
  if (!output.TemplateBody) {
    throw new Error('No template found');
  }
  process.stderr.write(`# Stages Available: ${output.StagesAvailable}\n`);
  process.stderr.write(`# Stage Shown: ${TemplateStage}\n\n`);
  switch (argv.format) {
  case 'yaml':
    if (output.TemplateBody.match(/ *\{/)) {
      console.log(yaml.dump(JSON.parse(output.TemplateBody)))
    } else {
      console.log(output.TemplateBody);
    }
    break;
  case 'json':
    if (output.TemplateBody.indexOf('{') === 0) {
      console.log(output.TemplateBody);
    } else {
      console.log(JSON.parse(yaml.loadString(output.TemplateBody, 'cfn')));
    }
    break;
  case 'original':
    console.log(output.TemplateBody);
    break;
  default:
    console.log(output.TemplateBody);
  }

  return 0;
}

import * as inquirer from 'inquirer';

export async function deleteStackMain(argv: Arguments): Promise<number> {
  const region = argv.region;
  await configureAWS(argv.profile, region);

  const StackName = argv.stackname;

  console.log();
  await summarizeStackProperties(StackName, region, true);
  console.log();

  console.log(cli.underline('Previous 10 Stack Events:'))
  await showStackEvents(StackName, 10);
  console.log();
  const {StackId} = await summarizeCompletedStackOperation(StackName);

  let resp = await inquirer.prompt(
    {name: 'confirm',
     type:'confirm', default: false,
     message:`Are you sure you want to DELETE the stack ${StackName}?`})
  if (resp.confirm) {
    const cfn = new aws.CloudFormation();
    const deleteStackOutput = await cfn.deleteStack({StackName}).promise();
    const startTime = new Date();
    await watchStack(StackId as string, startTime);
    console.log();
    const {StackStatus} = await summarizeCompletedStackOperation(StackId as string);
    return StackStatus == 'DELETE_COMPLETE' ? 0 : 1;
  } else {
    return 1
  }
}

  // TODO additional validation
  //import * as cfnLint from 'cfn-lint/lib/validator';
  // if (TemplateBody) {
  //     const validationResult = cfnLint.validateJsonObject(yaml.loadString(TemplateBody, Template));
  //     for(let crit of validationResult['errors']['crit']){
  //         console.log(crit);
  //         console.log('Resource: ' + crit['resource']);
  //         console.log('Message: ' + crit['message']);
  //         console.log('Documentation: ' + crit['documentation'] + '\n');
  //     }
  // }
