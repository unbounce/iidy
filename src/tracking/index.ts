import * as fs from 'fs';
import * as _ from 'lodash';
import * as jsyaml from 'js-yaml';
import * as path from 'path';
import * as yargs from 'yargs';
import * as child_process from 'child_process';
import {Arguments} from 'yargs';
import unparse = require('yargs-unparser');

import * as yaml from '../yaml';
import {logger} from '../logger';

const stackfilePath = '.iidy/stacks.yaml';
const stackfileDir = path.dirname(stackfilePath);

type Stackfile = {
  stacks: StackfileMetadata[]
}

// "Private" metadata, written to .iidy/stacks.yaml
type StackfileMetadata = {
  name: string;
  argsfile: string;
  args: Partial<Arguments>;
  environment: { [name: string]: string };
};

// "Public" metadata for use by cfn module
type StackMetadata = {
  args: Partial<Arguments>;
  argsfile: string;
  displayCommand: string;
  argv: string[];
  env: object;
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

export function relevantEnvVars(argsfile: string): Record<string, string> {
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

function stackfileMetadata(stackName: string, argsfile: string, argv: Arguments): StackfileMetadata {
  return {
    name: stackName,
    argsfile: argsfile,
    args: relevantOptions(argv),
    environment: relevantEnvVars(argsfile),
  }
}

export function relevantOptions(argv: Arguments): Partial<Arguments> {
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
  return _.pick(result, ['environment', 'region', 'profile', 'stack-name']);
}

export function filterOnOptions(stacks: StackMetadata[], providedOptions: Partial<Arguments>): StackMetadata[] {
  const matchingStacks: StackMetadata[] = [];

  for(const stack of stacks) {
    if(_.every(_.keys(providedOptions), (k) => stack.args[k] === providedOptions[k])) {
      matchingStacks.push(stack);
    }
  }

  return matchingStacks;
}

export function trackedStacks(dir: string, iidyExecutable: string, command: string, extraArgs: string[] = []): StackMetadata[] {
  const stackfile = loadStackfile(dir);

  return _.map(stackfile.stacks, (stack) => {
    const env = {...stack.environment, ...relevantEnvVars(stack.argsfile)};
    const envVars = _.reduce(env, (acc: string[], v, k) => acc.concat(`${k}=${v}`), []);
    const displayArgs = ['iidy', command, stack.argsfile, ...unparseArgv(stack.args), ...extraArgs];
    const argv = [iidyExecutable, command, stack.argsfile, ...unparseArgv(stack.args), ...extraArgs];

    return {
      displayCommand: [...envVars, ...displayArgs].join(' '),
      args: stack.args,
      argsfile: stack.argsfile,
      argv,
      env
    };
  });
}

function loadStackfile(dir: string = process.cwd()): Stackfile {
  try {
    const filepath = path.join(dir, stackfilePath);
    const existing = jsyaml.safeLoad(fs.readFileSync(filepath).toString());
    if (_.isObject(existing) && _.isArray(existing.stacks)) {
      return existing;
    } else {
      return { stacks: [] };
    }
  } catch {
    return { stacks: [] };
  }
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
  const stack = stackfileMetadata(stackName, argsfile, argv);

  if(!_.some(stackfile.stacks, (existing) => _.isEqual(existing, stack))) {
    stackfile.stacks.push(stack);
    writeStackfile(stackfile);
  }
}

// Recursively return all directories that contain an .iidy/stack.yaml file
export function trackedDirectories(dir: string, dirs: string[] = []) {
  const relativePaths = fs.readdirSync(dir);
  return _.reduce(relativePaths, (acc, relativePath) => {
    const absolutePath = path.join(dir, relativePath);
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      if (relativePath === stackfileDir) {
        if (fs.existsSync(path.join(dir, stackfilePath))) {
          acc.push(dir);
        }
      } else {
        trackedDirectories(absolutePath, acc);
      }
    }
    return acc;
  }, dirs);
}

export function updateExistingStacks(stacks: StackMetadata[]): boolean {
  for(const stack of stacks) {
    if (!fs.existsSync(stack.argsfile)) {
      logger.error(`Tracked argsfile '${stack.argsfile}' does not exist`);
      return false;
    }

    logger.info(`Running: ${stack.displayCommand}`);

    // Allow environment variables to be overridden by merging in relevantEnvVars last
    const env = { ...process.env, ...stack.env };
    const child = child_process.spawnSync(process.argv[0], stack.argv, { stdio: 'inherit', env });
    if(child.status !== 0) {
      return false;
    }
  }
  return true;
}
