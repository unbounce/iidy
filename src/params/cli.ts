import {Handler, Argv, Options, description, wrapCommandHandler} from '../cli/utils';

export interface ParamCommands {
  setParam: Handler;
  reviewParam: Handler;
  getParam: Handler;
  getParamsByPath: Handler;
  getParamHistory: Handler;
}

const lazyLoad = (fnname: keyof ParamCommands): Handler =>
  (args) => require('../params')[fnname](args);

const lazy: ParamCommands = {
  setParam: lazyLoad('setParam'),
  reviewParam: lazyLoad('reviewParam'),
  getParam: lazyLoad('getParam'),
  getParamsByPath: lazyLoad('getParamsByPath'),
  getParamHistory: lazyLoad('getParamHistory'),
}

const decryptOption: Options = {
  type: 'boolean', default: true,
  description: 'decrypt or not'
};

const formatOption: Options = {
  type: 'string', default: 'simple',
  description: 'output format. simple = values only not meta data',
  choices: ['simple', 'yaml', 'json']
};

export function buildParamCommands(args: Argv, commands = lazy): Argv {
  return args
    .strict()
    .demandCommand(1, 0)

    .command(
    'set <path> <value>',
    description('set a parameter value'),
    (args) =>
      args
        .option('message', {
          type: 'string',
          description: 'descriptive message for parameter'
        })
        .option('overwrite', {
          type: 'boolean', default: false,
          description: 'overwrite existing parameters'
        })
        .option('with-approval', {
          type: 'boolean', default: false,
          description: 'require parameter review to apply change'
        })
        .option('type', {
          type: 'string', default: 'SecureString',
          description: 'parameter type',
          choices: ['String', 'StringList', 'SecureString']
        }),
    wrapCommandHandler(commands.setParam))

    .command(
    'review <path>',
    description('review a pending change'),
    (args) => args,
    wrapCommandHandler(commands.reviewParam))

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
