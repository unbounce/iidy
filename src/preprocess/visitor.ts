import * as _ from 'lodash';
import * as escapeStringRegexp from 'escape-string-regexp';
import * as handlebars from 'handlebars';

import * as yaml from '../yaml';
import {logger} from '../logger';

import {
  Env,
  $EnvValues,
  AnyButUndefined,
  ExtendedCfnDoc,
  GlobalSection,
  GlobalSectionNames,
  MaybeStackFrame,
  validateTemplateParameter,
  interpolateHandlebarsString,
  appendPath
} from './index';

const HANDLEBARS_RE = /{{(.*?)}}/;
const CFN_SUB_RE = /\${([^!].*?)}/g;

const _flatten = <T>(arrs: T[][]): T[] => _.flatten(arrs)

const _isPlainMap = (node: any): node is object =>
  _.isObject(node) &&
  !_.get(node, 'is_yaml_tag') &&
  !_.isDate(node) &&
  !_.isRegExp(node) &&
  !_.isFunction(node);

/**
* Splits an import `!$ string` into dot-delimited chunks.
* Dynamic key segments within brackets are included in the preceeding chunk.
*
* See examples in ../tests/test-visitor.ts under this fn's name.
*/
export const _parse$includeKeyChunks = (key: string, path: string): string[] => {
  const keyChunks = [];
  let remaining = key;
  let i = 0;
  let bracketDepth = 0;
  while (i < remaining.length) {
    if (remaining[i] === '.' && bracketDepth === 0) {
      keyChunks.push(remaining.slice(0, i));
      remaining = remaining.slice(i + 1);
      i = 0
    } else if (remaining[i] === '[') {
      bracketDepth++
      i++
    } else if (remaining[i] === ']') {
      bracketDepth--
      i++
    } else {
      i++
    }
    if (i === remaining.length) {
      keyChunks.push(remaining);
      if (bracketDepth > 0) {
        throw new Error(`Unclosed brackets path=${path} pos=${i} bracketDepth=${bracketDepth} remaining=${remaining}`);
      }
      break;
    }
  }
  return keyChunks;
}

export const mkSubEnv = (env: Env, $envValues: $EnvValues, frame: MaybeStackFrame): Env => {
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


const _liftKVPairs = (objects: {key: string, value: any}[]) =>
  _.fromPairs(_.map(objects, ({key, value}) => [key, value]))

export const extendedCfnDocKeys = [
  '$imports',
  '$defs',
  '$params',
  '$location',
  '$envValues'
];

function mapCustomResourceToGlobalSections(
  resourceDoc: ExtendedCfnDoc,
  path: string,
  env: Env
): void {

  _.forEach(GlobalSectionNames, (section: GlobalSection) => {
    if (resourceDoc[section]) {
      const visitor = new Visitor();
      const res = _.merge(
        env.GlobalAccumulator[section], // mutate in place
        _.fromPairs(
          // TOOD is this the right place to be visiting the subsections
          _.map(_.toPairs(visitor.visitNode(resourceDoc[section], appendPath(path, section), env)),
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

function lookupInEnv(key: string, path: string, env: Env): AnyButUndefined {
  if (typeof key !== 'string') { // tslint:disable-line
    // this is called with the .data attribute of custom yaml tags which might not be
    // strings.
    throw new Error(`Invalid lookup key ${JSON.stringify(key)} at ${path}`)
  }
  const res = env.$envValues[key];
  if (_.isUndefined(res)) {
    logger.debug(`Could not find "${key}" at ${path}}`, {env})
    throw new Error(`Could not find "${key}" at ${path}`);
  } else {
    return res;
  }
}

export class Visitor {
  // The functions in this class are stateless - they are only wrapped in a
  // class so that the functionality can be extended

  visitYamlTagNode(node: yaml.Tag, path: string, env: Env): AnyButUndefined {
    if (node instanceof yaml.$include) {
      return this.visit$include(node, path, env);
    } else if (node instanceof yaml.$expand) {
      return this.visit$expand(node, path, env);
    } else if (node instanceof yaml.$escape) {
      return this.visit$escape(node, path, env);
    } else if (node instanceof yaml.$string) {
      return this.visit$string(node, path, env);
    } else if (node instanceof yaml.$parseYaml) {
      return this.visit$parseYaml(node, path, env);
    } else if (node instanceof yaml.$if) {
      return this.visit$if(node, path, env);
    } else if (node instanceof yaml.$eq) {
      return this.visit$eq(node, path, env);
    } else if (node instanceof yaml.$not) {
      return this.visit$not(node, path, env);
    } else if (node instanceof yaml.$let) {
      return this.visit$let(node, path, env);
    } else if (node instanceof yaml.$map) {
      return this.visit$map(node, path, env);
    } else if (node instanceof yaml.$mapValues) {
      return this.visit$mapValues(node, path, env);
    } else if (node instanceof yaml.$merge) {
      return this.visit$merge(node, path, env);
    } else if (node instanceof yaml.$mergeMap) {
      return this.visit$mergeMap(node, path, env);
    } else if (node instanceof yaml.$concat) {
      return this.visit$concat(node, path, env);
    } else if (node instanceof yaml.$concatMap) {
      return this.visit$concatMap(node, path, env);
    } else if (node instanceof yaml.$mapListToHash) {
      return this.visit$mapListToHash(node, path, env);
    } else if (node instanceof yaml.$groupBy) {
      return this.visit$groupBy(node, path, env);
    } else if (node instanceof yaml.$fromPairs) {
      return this.visit$fromPairs(node, path, env);
    } else if (node instanceof yaml.$split) {
      return this.visit$split(node, path, env);
    } else if (node instanceof yaml.Ref) {
      return this.visitRef(node, path, env);
    } else if (node instanceof yaml.GetAtt) {
      return this.visitGetAtt(node, path, env);
    } else if (node instanceof yaml.Sub) {
      return this.visitSub(node, path, env);
    } else {
      return node.update(this.visitNode(node.data, path, env));
    }
  }

  visit$escape(node: yaml.$escape, _path: string, _env: Env): AnyButUndefined {
    return node.data;
  }

  visit$expand(node: yaml.$expand, path: string, env: Env): AnyButUndefined {
    if (!_.isEqual(_.sortBy(_.keys(node.data)), ['params', 'template'])) {
      // TODO use json schema instead
      throw new Error(`Invalid arguments to $expand: ${_.sortBy(_.keys(node.data))}`);
    } else {
      const {template: templateName, params} = node.data;
      // TODO remove the need for this cast
      const template: ExtendedCfnDoc = _.clone(lookupInEnv(templateName, path, env)) as ExtendedCfnDoc;
      const stackFrame = {location: template.$location, path: appendPath(path, '!$expand')};
      const $paramDefaultsEnv = mkSubEnv(env, {...template.$envValues}, stackFrame);
      const $paramDefaults = _.fromPairs(
        _.filter(
          _.map(
            template.$params,
            (v) => [
              v.Name,
              this.visitNode(v.Default, appendPath(path, `$params.${v.Name}`), $paramDefaultsEnv)]),
          ([_k, v]) => !_.isUndefined(v)));
      const providedParams = this.visitNode(params, appendPath(path, 'params'), env);
      const mergedParams = _.assign({}, $paramDefaults, providedParams);
      _.forEach(template.$params, (param) => validateTemplateParameter(param, mergedParams, '!$expand', env));
      const subEnv = mkSubEnv(env, {...mergedParams, ...template.$envValues}, stackFrame);
      delete template.$params;
      // TODO might also need to delete template.$imports, template.$envValues, and template.$defs
      return this.visitNode(template, path, subEnv);
    }
  }

  visit$include(node: yaml.$include, path: string, env: Env): AnyButUndefined {
    const searchChunks = _parse$includeKeyChunks(node.data, path)
    const lookupRes: any = searchChunks.reduce( // tslint:disable-line:no-any
      (result0: any, subKey: string, i) => {                  // tslint:disable-line:no-any
        const result = this.visitNode(result0, path, env); // calling this.visitNode here fixes issue #75
        if (_.isUndefined(result) && i > 0) {
          throw new Error(`Could not find ${subKey} in ${node.data} at ${path}`);
        }
        // the result0 might contain pre-processor constructs that need evaluation before continuing
        const bracketsMatch = subKey.match(/\[(.*)\] *$/); // dynamic key chunk
        if (bracketsMatch) {
          // e.g. !$ foo[bar], foo[bar[baz]], etc.
          const basekey = subKey.slice(0, bracketsMatch.index);
          const dynamicKey = bracketsMatch[1].trim();
          return this._visit$includeDynamicKey(dynamicKey, basekey, `${dynamicKey} in ${path}`, env, result);
        } else {
          const subEnv = i === 0 ? env : mkSubEnv(env, {...result}, {path});
          return lookupInEnv(subKey.trim(), `${subKey} in ${path}`, subEnv);
        }
      },
      undefined);

    if (_.isUndefined(lookupRes)) {
      throw new Error(`Could not find ${node.data} at ${path}`);
    } else {
      return this.visitNode(lookupRes, path, env);
    }
  }

  _visit$includeDynamicKey(dynamicKey: string, basekey: string, path: string, env: Env, lastResult: any) {
    const newKeyParts: string[] = [];
    for (const part of dynamicKey.trim().split('][')) {
      // this loop enables handling of successive, unnested dynamic keys
      // e.g. 'obj[key1][key2]'. See the tests in src/test/test-visitor.ts
      if (Number.isSafeInteger(parseInt(part, 10))) {
        newKeyParts.push(part)
      } else {
        const bracketVal = this.visit$include(new yaml.$include(part), `${path} / ${dynamicKey}` , env);
        if (typeof bracketVal === 'number') {
          newKeyParts.push(String(bracketVal))
        } else if (typeof bracketVal === 'string') {
          newKeyParts.push(bracketVal)
        } else {
          throw new Error(`Invalid dynamic key value ${bracketVal} for ${dynamicKey} at ${path}`);
        }
      }
    }
    const newKey = basekey + '.' + newKeyParts.join('.');
    const subEnv = _.isUndefined(lastResult) ? env : mkSubEnv(env, {...lastResult}, {path});
    return this.visit$include(new yaml.$include(newKey), `${newKey} from ${basekey} in ${path}`, subEnv);
  }

  visit$if(node: yaml.$if, path: string, env: Env): AnyButUndefined {
    if (this.visitNode(node.data.test, path, env)) {
      return this.visitNode(node.data.then, path, env);
    } else {
      return this.visitNode(node.data.else, path, env);
    }
  }

  visit$eq(node: yaml.$eq, path: string, env: Env): AnyButUndefined {
    return this.visitNode(node.data[0], path, env) == this.visitNode(node.data[1], path, env);
  }

  visit$not(node: yaml.$not, path: string, env: Env): AnyButUndefined {
    const expr = (_.isArray(node.data) && node.data.length === 1)
      ? node.data[0]
      : node.data;
    return !this.visitNode(expr, path, env);
  }

  visit$let(node: yaml.$let, path: string, env: Env): AnyButUndefined {
    const subEnv = mkSubEnv(
      env,
      {...env.$envValues, ...this.visitNode(_.omit(node.data, ['in']), path, env)},
      {path});
    return this.visitNode(node.data.in, path, subEnv);
  }

  visit$map(node: yaml.$map, path: string, env: Env): AnyButUndefined {
    // TODO validate node.data's shape or even better do this during parsing
    //    template: any, items: [...]
    const {template, items} = node.data
    // TODO handle nested maps
    const varName = node.data.var || 'item';
    const SENTINEL = {};
    const mapped = _.without(_.map(this.visitNode(items, path, env), (item0: any, idx: number) => {
      // TODO improve stackFrame details
      const subPath = appendPath(path, idx.toString());
      const item = this.visitNode(item0, subPath, env); // visit pre expansion
      const subEnv = mkSubEnv(
        env, {...env.$envValues, [varName]: item, [varName + 'Idx']: idx}, {path: subPath});
      if (node.data.filter && !this.visitNode(node.data.filter, path, subEnv)) {
        return SENTINEL;
      } else {
        return this.visitNode(template, subPath, subEnv);
      }
    }), SENTINEL);
    return this.visitNode(mapped, path, env); // TODO do we need to visit again like this?
  }

  visit$mapValues(node: yaml.$mapValues, path: string, env: Env): AnyButUndefined {
    const input = this.visitNode(node.data.items, path, env);
    const keys = this.visitNode(_.keys(input), path, env);
    const varName = node.data.var || 'item';
    const valuesMap = new yaml.$map({
      items: _.map(input, (value, key) => ({value, key})),
      template: node.data.template,
      'var': varName
    });
    return _.fromPairs(_.zip(keys, this.visitNode(valuesMap, path, env)));
  }

  visit$string(node: yaml.$string, path: string, env: Env): string {
    const stringSource = (_.isArray(node.data) && node.data.length === 1)
      ? node.data[0]
      : node.data;
    return yaml.dump(this.visitNode(stringSource, path, env));
  }

  visit$merge(node: yaml.$merge, path: string, env: Env): AnyButUndefined[] {
    const input: any = _.isString(node.data) ? this.visit$include(new yaml.$include(node.data), path, env) : this.visitNode(node.data, path, env);
    if (!_.isArray(input) && _.every(input, _.isObject)) {
      throw new Error(`Invalid argument to $merge at "${path}".`
        + " Must be array of arrays.");
    }
    return this.visitNode(_.merge.apply(_, input), path, env);
  }

  visit$mergeMap(node: yaml.$mergeMap, path: string, env: Env): AnyButUndefined {
    return _.merge.apply(_, this.visitNode(new yaml.$map(node.data), path, env));
  }

  visit$concat(node: yaml.$concat, path: string, env: Env): AnyButUndefined[] {
    const error = new Error(`Invalid argument to $concat at "${path}".`
      + " Must be array of arrays.")

    if (!_.isArray(node.data)) {
      throw error;
    }

    const data = _.map(node.data, (d) => this.visitNode(d, path, env));

    if (!_.every(data, _.isArray)) {
      throw error;
    }

    return _flatten(data);
  }

  visit$parseYaml(node: yaml.$parseYaml, path: string, env: Env): AnyButUndefined {
    return this.visitNode(yaml.loadString(this.visitString(node.data, path, env), path), path, env);
  }

  visit$concatMap(node: yaml.$concatMap, path: string, env: Env): AnyButUndefined {
    return _flatten(this.visitNode(new yaml.$map(node.data), path, env));
  }

  visit$groupBy(node: yaml.$groupBy, path: string, env: Env): AnyButUndefined {
    const varName = node.data.var || 'item';
    const grouped = _.groupBy(this.visitNode(node.data.items, path, env), (item0) => {
      const item = this.visitNode(item0, path, env); // visit pre expansion
      const subEnv = mkSubEnv(env, {...env.$envValues, [varName]: item}, {path});
      return this.visitNode(node.data.key, path, subEnv);
    });

    if (node.data.template) {
      return _.mapValues(
        grouped,
        (items) => _.map(items, (item0) => {
          const item = this.visitNode(item0, path, env); // visit pre expansion
          const subEnv = mkSubEnv(env, {...env.$envValues, [varName]: item}, {path});
          return this.visitNode(node.data.template, path, subEnv);
        }));
    } else {
      return grouped;
    }
  }

  visit$fromPairs(node: yaml.$fromPairs, path: string, env: Env): AnyButUndefined {
    let input: any = node.data; // TODO tighten this type
    if (input.length === 1 && input[0] instanceof yaml.$include) {
      input = this.visit$include(input[0], path, env);
    }
    if (input.length > 0 && _.has(input[0], 'Key') && _.has(input[0], 'Value')) {
      input = _.map(input, (i) => ({key: _.get(i, 'Key') as string, value: _.get(i, 'Value')}))
    }
    return this.visitNode(_liftKVPairs(input), path, env);
  }

  visit$split(node: yaml.$split, path: string, env: Env): string[] {
    if (_.isArray(node.data) && node.data.length === 2) {
      const [delimiter, str]: [string, string] = node.data;
      const escapedDelimiter = escapeStringRegexp(delimiter);
      return this.visitNode(str, path, env)
        .toString()
        .replace(new RegExp(`${escapedDelimiter}+$`), '') // Remove trailing delimiters
        .split(delimiter);
    } else {
      throw new Error(`Invalid argument to $split at "${path}".`
        + " Must be array with two elements: a delimiter to split on and a string to split");
    }
  }

  visit$mapListToHash(node: yaml.$mapListToHash, path: string, env: Env): AnyButUndefined {
    return _liftKVPairs(this.visitNode(new yaml.$map(node.data), path, env));
  }

  shouldRewriteRef(ref: string, env: Env) {
    const globalRefs = env.$envValues.$globalRefs || {};
    const isGlobal = _.has(globalRefs, ref);
    return env.$envValues.Prefix && !(isGlobal || ref.startsWith('AWS:'));
  }

  maybeRewriteRef(ref0: string, path: string, env: Env) {
    const ref = this.visitNode(ref0, path, env);
    if (this.shouldRewriteRef(ref.trim().split('.')[0], env)) {
      return `${env.$envValues.Prefix || ''}${ref.trim()}`;
    } else {
      return ref;
    }
  }

  visitRef(node: yaml.Ref, path: string, env: Env): yaml.Ref {
    return new yaml.Ref(this.maybeRewriteRef(node.data, path, env));
  }

  visitGetAtt(node: yaml.GetAtt, path: string, env: Env): yaml.GetAtt {
    if (_.isArray(node.data)) {
      const argsArray = _.clone(node.data);
      argsArray[0] = this.maybeRewriteRef(argsArray[0], path, env);
      return new yaml.GetAtt(argsArray);
    } else { // it's a string
      return new yaml.GetAtt(this.maybeRewriteRef(node.data, path, env));
    }
  }

  visitSubStringTemplate(template0: string, path: string, env: Env) {
    let template = this.visitString(template0, path, env);
    if (template.search(CFN_SUB_RE) > -1) {
      template = template.replace(CFN_SUB_RE, (match, g1) => {
        if (this.shouldRewriteRef(g1.trim().split('.')[0], env)) {
          return `\${${this.maybeRewriteRef(g1, path, env)}}`
        } else {
          return match;
        }
      });
    }
    return template;
  }

  visitSub(node: yaml.Sub, path: string, env: Env): yaml.Sub {
    if (_.isArray(node.data) && node.data.length === 1) {
      return new yaml.Sub(this.visitSubStringTemplate(this.visitNode(node.data[0], path, env), path, env));
    } else if (_.isArray(node.data) && node.data.length === 2) {
      const templateEnv = node.data[1];
      const subEnv = mkSubEnv(
        env, {...env.$envValues, $globalRefs: _.fromPairs(_.map(_.keys(templateEnv), (k) => [k, true]))},
        {path});
      const template = this.visitSubStringTemplate(this.visitNode(node.data[0], path, env), path, subEnv);
      return new yaml.Sub([template, this.visitNode(templateEnv, path, env)]);
    } else if (_.isString(node.data)) {
      return new yaml.Sub(this.visitSubStringTemplate(node.data, path, env));
    } else {
      throw new Error(`Invalid arguments to !Sub: ${node.data}`);
    }
  }

  visitNode(node: any, path: string, env: Env): any {
    const currNode = path.split('.').pop();
    // Avoid serializing large `env` data when debug is not enabled
    if(logger.isDebugEnabled()) {
      logger.debug(`entering ${path}:`, {node, nodeType: typeof node, env});
    }
    const result = (() => {
      if (currNode === 'Resources' && path.indexOf('Overrides') === -1) {
        return this.visitResourceNode(node, path, env);
      } else if (currNode === '$envValues') {
        // filtered out in visitMapNode
        throw new Error(`Shouldn't be able to reach here: ${path}`);
      } else if (node instanceof yaml.Tag) {
        return this.visitYamlTagNode(node, path, env);
      } else if (_.isArray(node)) {
        return this.visitArray(node, path, env);
      } else if (_isPlainMap(node)) {
        return this.visitPlainMap(node, path, env);
      } else if (node instanceof Date) {
        return this.visitDate(node, path, env);
      } else if (typeof node === 'string') {
        return this.visitString(node, path, env);
      } else {
        return node;
      }
    })();
    if(logger.isDebugEnabled()) {
      logger.debug(`exiting ${path}:`, {result, node, env});;
    }
    return result;
  };

  visitImportedDoc(node: ExtendedCfnDoc, path: string, env: Env): AnyButUndefined {
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
    const nodeTypes = _.groupBy(_.toPairs(node.$envValues), ([_k, v]) => `${_.has(v, '$params')}`);
    const nonTemplates = _.fromPairs(_.get(nodeTypes, 'false'));
    const templates = _.fromPairs(_.get(nodeTypes, 'true'));
    const processedEnvValues = _.merge({}, this.visitNode(nonTemplates, path, subEnv0), templates);
    const subEnv = mkSubEnv(env, processedEnvValues, stackFrame);
    return this.visitMapNode(node, path, subEnv);
  }

  visitDate(node: Date, path: string, _env: Env): Date | string {
    const currNode = path.split('.').pop();
    if (_.includes(['Version', 'AWSTemplateFormatVersion'], currNode)) {
      // common error in cfn / yaml
      return node.toISOString().split('T')[0];
    } else {
      return node;
    }
  }

  _isImportedDoc(node: {}): node is ExtendedCfnDoc {
    return _isPlainMap(node) && _.has(node, '$envValues')
  }

  visitPlainMap(node: {}, path: string, env: Env): AnyButUndefined {
    // TODO tighten node type
    if (_.has(node, '$params')) {
      throw new Error(
        `Templates should be called via !$expand or as CFN resource types: ${path}\n ${yaml.dump(node)}`);
    } else if (this._isImportedDoc(node)) {
      return this.visitImportedDoc(node, path, env);
    } else {
      return this.visitMapNode(node, path, env);
    }
  }

  visitMapNode(node: any, path: string, env: Env): AnyButUndefined {
    // without $merge it would just be:
    //return  _.mapValues(node, (v, k) => visitNode(v, appendPath(path, k), env));
    const res: {[key: string]: any} = {};
    for (const k in node) {
      if (k.indexOf('$merge') === 0) {
        const sub: any = this.visitNode(node[k], appendPath(path, k), env);
        for (const k2 in sub) {
          // mutate in place to acheive a deep merge
          _.merge(res, {[this.visitString(k2, path, env)]: sub[k2]});
        }
        // TODO handle ref rewriting on the Fn:Ref, Fn:GetAtt type functions
        //} else if ( .. Fn:Ref, etc. ) {
      } else if (_.includes(extendedCfnDocKeys, k)) {
        // we don't want to include things like $imports and $envValues in the output doc
        continue;
      } else {
        res[this.visitString(k, path, env)] = this.visitNode(node[k], appendPath(path, k), env);
      }
    }
    return res;
  }

  visitArray(node: AnyButUndefined[], path: string, env: Env): AnyButUndefined[] {
    return _.map(node, (v, i) => this.visitNode(v, appendPath(path, i.toString()), env));
  }

  visitHandlebarsString(node: string, path: string, env: Env): string {
    return interpolateHandlebarsString(node, env.$envValues, path);
  }

  visitString(node: string, path: string, env: Env): string {
    let res: string;
    if (node.search(HANDLEBARS_RE) > -1) {
      res = this.visitHandlebarsString(node, path, env);
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

  visitResourceNode(node: any, path: string, env: Env): AnyButUndefined {
    const visitor = new Visitor();
    const expanded: {[key: string]: any} = {};
    for (const k in node) {
      if (k.indexOf('$merge') === 0) {
        const sub: any = visitor.visitNode(node[k], appendPath(path, k), env);
        for (const k2 in sub) {
          expanded[visitor.visitString(k2, path, env)] = sub[k2];
        }
      } else if (_.includes(extendedCfnDocKeys, k)) {
        continue;
      } else {
        expanded[visitor.visitString(k, path, env)] = node[k]; // TODO? visitNode(node[k], appendPath(path, k), env);
      }
    }
    return this._visitResourceNode(expanded, path, env);
  }

  // TODO tighten up the return type here: {[key: string]: any}
  _visitResourceNode(node: object, path: string, env: Env): AnyButUndefined {
    const visitor = new Visitor();
    return _.fromPairs(
      _flatten( // as we may output > 1 resource for each template
        _.map(_.toPairs(node), ([name, resource]) => {
          if (_.has(env.$envValues, resource.Type)) {
            return this.visitCustomResource(name, resource, path, env);
          } else if (resource.Type &&
            (resource.Type.indexOf('AWS') === 0
              || resource.Type.indexOf('Custom') === 0)) {
            return [[name, visitor.visitNode(resource, appendPath(path, name), env)]]
          } else {
            throw new Error(
              `Invalid resource type: ${resource.Type} at ${path}: ${JSON.stringify(resource, null, ' ')}`)
          }
        })
      ));
  }

  visitCustomResource(name: string, resource: any, path: string, env: Env) {
    const template: ExtendedCfnDoc = env.$envValues[resource.Type] as ExtendedCfnDoc;
    if (_.isUndefined(template)) {
      throw new Error(
        `Invalid custom resource type: ${resource.Type} at ${path}: ${JSON.stringify(resource, null, ' ')}`)
    }
    // TODO s/NamePrefix/$namePrefix/
    const prefix = _.isUndefined(resource.NamePrefix) ? name : resource.NamePrefix;
    const stackFrame = {location: template.$location, path: appendPath(path, name)};
    const visitor = new Visitor();
    const resourceDoc = _.merge(
      {}, template,
      visitor.visitNode(resource.Overrides,
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

    const $paramDefaultsEnv = mkSubEnv(env, {Prefix: prefix, ...template.$envValues}, stackFrame);

    const $paramDefaults = _.fromPairs(
      _.filter(
        _.map(
          template.$params,
          (v) => [v.Name,
          visitor.visitNode(v.Default, appendPath(path, `${name}.$params.${v.Name}`), $paramDefaultsEnv)]),
        ([_k, v]) => !_.isUndefined(v)));

    const providedParams = visitor.visitNode(resource.Properties, appendPath(path, `${name}.Properties`), env);
    // TODO factor this out:
    // TODO validate providedParams against template.$params[].type json-schema
    // ! 1 find any missing params with no defaults
    // 2 check against AllowedValues and AllowedPattern
    // 3 check min/max Value / Length
    const mergedParams = _.assign({}, $paramDefaults, providedParams);
    _.forEach(template.$params, (param) => validateTemplateParameter(param, mergedParams, name, env));

    const subEnv = mkSubEnv(
      env,
      {
        Prefix: prefix,
        $globalRefs,
        ...mergedParams,
        ...template.$envValues
      },
      stackFrame);

    // TODO consider just visitNode on the entire resourceDoc here
    //      ... that requires finding a way to avoid double processing of .Resources
    const outputResources = visitor.visitNode(resourceDoc.Resources, appendPath(path, `${name}.Resources`), subEnv)
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

}

class HandlebarsVariablesTrackingVisitor extends handlebars.Visitor {
  constructor(public variables: string[]) {
    super();
  };

  BlockStatement(block: hbs.AST.BlockStatement): void {
    if (_.isEmpty(block.params)) {
      if ('original' in block.path) {
        this.variables.push(block.path.original);
      }
    } else {
      for (const expression of block.params) {
        this.Expression(expression);
      }
    }
  }

  PartialBlockStatement(partial: hbs.AST.PartialBlockStatement): void {
    for (const expression of partial.params) {
      this.Expression(expression);
    }
  }

  MustacheStatement(mustache: hbs.AST.MustacheStatement): void {
    if (_.isEmpty(mustache.params)) {
      if ('original' in mustache.path) {
        this.variables.push(mustache.path.original);
      }
    } else {
      for (const expression of mustache.params) {
        this.Expression(expression);
      }
    }
  }

  // Expression is not part of handlebars.Visitor
  Expression(expression: hbs.AST.Expression): void {
    if ('params' in expression) {
      for (const ex of (expression as hbs.AST.SubExpression).params) {
        this.Expression(ex);
      }
    } else {
      if ('original' in expression) {
        this.variables.push((expression as hbs.AST.PathExpression).original);
      }
    }
  }
}

export class VariablesTrackingVisitor extends Visitor {
  public variables: string[] = [];

  visitHandlebarsString(node: string, _path: string, _env: Env): string {
    const ast = handlebars.parse(node);
    const v = new HandlebarsVariablesTrackingVisitor(this.variables);
    v.accept(ast);
    return node;
  }

  visit$include(node: yaml.$include, _path: string, _env: Env): AnyButUndefined {
    this.variables.push(node.data);
    return node.data;
  }

  visitMapNode(node: any, path: string, env: Env): AnyButUndefined {
    for (const key in node) {
      if (_.includes(['$imports', '$defs'], key)) {
        this.visitNode(node[key], appendPath(path, key), env);
      }
    }

    return super.visitMapNode(node, path, env);
  }

}
