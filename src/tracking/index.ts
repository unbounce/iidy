import * as fs from 'fs';
import * as _ from 'lodash';
import * as jsyaml from 'js-yaml';
import unparse = require('yargs-unparser');

import * as yaml from '../yaml';

import { buildArgs } from '../main';

type Stackfile = {
  stacks: StackMetadata[]
}

type StackMetadata = {
  name: string;
  argsfile: string;
  args: string[];
  env: { [name: string]: string };
};

function importedEnvVars(argsfile: string): string[] {
  const vars: string[] = [];
  const argsdata = yaml.loadString(fs.readFileSync(argsfile), argsfile);
  if ('$imports' in argsdata) {
    for(const key in argsdata['$imports']) {
      const value = argsdata['$imports'][key];
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

function cliArgs(argv: object) {
  // @ts-ignore
  const options = buildArgs().getOptions();
  const args = unparse(argv, {
    alias: options.alias,
    default: options.default
  });
  const ignoredArgs = ['create-stack', 'update-stack', '--track'];
  return _.filter(args, (arg) => !_.includes(ignoredArgs, arg));
}

function stackMetadata(stackName: string, argsfile: string, argv: object): StackMetadata {
  return {
    name: stackName,
    argsfile: argsfile,
    args: cliArgs(argv),
    env: usedEnvVars(argsfile),
  }
}

function loadStackfile(): Stackfile {
  try {
    const existing = jsyaml.safeLoad(fs.readFileSync('.iidy/stacks.yaml').toString());
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
    fs.mkdirSync('.iidy');
  } catch(e) {
    if(e.code === 'EEXIST')  {
      const dir = fs.statSync('.iidy');
      if(!dir.isDirectory()) {
        throw e;
      }
    } else {
      throw e;
    }
  }
  fs.writeFileSync('.iidy/stacks.yaml', jsyaml.dump(stackfile));
}

export function track(stackName: string, argsfile: string, argv: object) {
  const stackfile = loadStackfile();
  const stack = stackMetadata(stackName, argsfile, argv);

  if(!_.some(stackfile.stacks, (existing) => _.isEqual(existing, stack))) {
    stackfile.stacks.push(stack);
    writeStackfile(stackfile);
  }
}
