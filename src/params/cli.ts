import * as yargs from 'yargs';

import {description, Handler, wrapCommandHandler} from '../cli';

export interface ParamCommands {
  setParam: Handler;
  getParam: Handler;
  getParamsByPath: Handler;
  getParamHistory: Handler;
}

const lazyLoad = (fnname: keyof ParamCommands): Handler =>
  (args) => require('../preprocess')[fnname](args);

const lazy: ParamCommands = {
  setParam: lazyLoad('setParam'),
  getParam: lazyLoad('getParam'),
  getParamsByPath: lazyLoad('getParamsByPath'),
  getParamHistory: lazyLoad('getParamHistory'),
}

const decryptOption: yargs.Options = {
  type: 'boolean', default: true,
  description: 'decrypt or not'
};

const formatOption: yargs.Options = {
  type: 'string', default: 'simple',
  description: 'output format. simple = values only not meta data',
  choices: ['simple', 'yaml', 'json']
};

export function buildParamCommands(args: yargs.Argv, commands = lazy): yargs.Argv {
  return args
    .strict()
    .demandCommand(1, 0)

    .command(
    'set <path> <value>',
    description('set a parameter value'),
    (args) =>
      args
        .option('overwrite', {
          type: 'boolean', default: false,
          description: 'overwrite existing parameters'
        })
        .option('type', {
          type: 'string', default: 'SecureString',
          description: 'parameter type',
          choices: ['String', 'StringList', 'SecureString']
        }),
    wrapCommandHandler(commands.setParam))

    .command('get <path>',
    description('get a parameter value'),
    (args) =>
      args
        .option('decrypt', decryptOption)
        .option('format', formatOption),
    wrapCommandHandler(commands.getParam))

    .command('get-by-path <path>',
    description('get a parameter value'),
    (args) =>
      args
        .option('decrypt', decryptOption)
        .option('format', formatOption)
        .option('recursive', {
          type: 'boolean', default: false,
          description: 'recurse into sub-paths'
        }),
    wrapCommandHandler(commands.getParamsByPath))

    .command('get-history <path>',
    description('get a parameter\'s history'),
    (args) =>
      args
        .option('format', formatOption)
        .option('decrypt', decryptOption),
    wrapCommandHandler(commands.getParamHistory))
}
