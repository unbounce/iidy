import * as fs from 'fs';
import * as _ from 'lodash';
import * as jsyaml from 'js-yaml';
import * as path from 'path';
import * as yargs from 'yargs';
import {Arguments} from 'yargs';
import unparse = require('yargs-unparser');

import * as yaml from '../yaml';

const stackfilePath = '.iidy/stacks.yaml';

type Stackfile = {
  stacks: StackMetadata[]
}

type StackMetadata = {
  name: string;
  argsfile: string;
  argv: Partial<Arguments>;
  env: { [name: string]: string };
};

function importedEnvVars(argsfile: string): string[] {
  const vars: string[] = [];
  const argsdata = yaml.loadString(fs.readFileSync(argsfile), argsfile);
  if ('$imports' in argsdata) {
    for(const key in argsdata.$imports) {
      const value = argsdata.$imports[key];
      if (typeof value === 'string' && value.match(/^env:/)) {
        const name = value.split(':')[1];
        if (typeof name === 'string' && name.length > 0) {
          vars.push(name);
        }
      }
    }
  }
  return vars;
}

function usedEnvVars(argsfile: string): Record<string, string> {
  const envVars: Record<string, string> = {};

  const trackedVars = [
    'AWS_PROFILE',
    'AWS_REIGON',
    'AWS_DEFAULT_REGION',
    /^IIDY_/,
  ].concat(importedEnvVars(argsfile));

  for(const name of Object.keys(process.env)) {
    if (_.some(trackedVars, (v: string|RegExp) => (v instanceof RegExp) ? name.match(v) : name === v)) {
      const value = process.env[name];
      if (value) {
        envVars[name] = value;
      }
    }
  }

  return envVars;
}

export function unparseArgv(argv: Partial<Arguments>) {
  // @ts-ignore
  const options = yargs.getOptions();
  const args = unparse(argv, {
    alias: options.alias,
    default: options.default
  });
  return args;
}

function stackMetadata(stackName: string, argsfile: string, argv: Arguments): StackMetadata {
  return {
    name: stackName,
    argsfile: argsfile,
    argv: _.pick(nonDefaultOptions(argv), ['environment', 'region', 'profile', 'stack-name']),
    env: usedEnvVars(argsfile),
  }
}

export function loadStackfile(): Stackfile {
  try {
    const existing = jsyaml.safeLoad(fs.readFileSync(stackfilePath).toString());
    if (_.isObject(existing) && _.isArray(existing.stacks)) {
      return existing;
    } else {
      return { stacks: [] };
    }
  } catch {
    return { stacks: [] };
  }
}

export function nonDefaultOptions(argv: Arguments): Partial<Arguments> {
  const result: Partial<Arguments> = {};
  // @ts-ignore
  const options = yargs.getOptions();
  // Skip aliases, as they just duplicate the thing they alias
  const aliases = _.reduce(options.alias, (acc, optionAliases) => acc.concat(optionAliases), []);
  for(const key in options.default) {
    if(!_.includes(aliases, key) && options.default[key] !== argv[key]) {
      result[key] = argv[key];
    }
  }
  return result;
}

export function trackedStacks(providedOptions: Partial<Arguments>): StackMetadata[] {
  const {stacks} = loadStackfile();
  const matchingStacks: StackMetadata[] = [];

  for(const stack of stacks) {
    if(_.every(_.keys(providedOptions), (k) => stack.argv[k] === providedOptions[k])) {
      matchingStacks.push(stack);
    }
  }

  return matchingStacks;
}

function writeStackfile(stackfile: Stackfile) {
  try {
    fs.mkdirSync(path.dirname(stackfilePath));
  } catch(e) {
    if(e.code === 'EEXIST')  {
      const dir = fs.statSync(path.dirname(stackfilePath));
      if(!dir.isDirectory()) {
        throw e;
      }
    } else {
      throw e;
    }
  }
  fs.writeFileSync(stackfilePath, jsyaml.dump(stackfile));
}

export function track(stackName: string, argsfile: string, argv: Arguments) {
  const stackfile = loadStackfile();
  const stack = stackMetadata(stackName, argsfile, argv);

  if(!_.some(stackfile.stacks, (existing) => _.isEqual(existing, stack))) {
    stackfile.stacks.push(stack);
    writeStackfile(stackfile);
  }
}
