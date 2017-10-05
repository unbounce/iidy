import * as process from 'process';
import * as yargs from 'yargs';
import * as cli from 'cli-color';

import { logger, setLogLevel } from './logger';
import debug from './debug';

export type ExitCode = number;
export type Handler = (args:yargs.Arguments) => Promise<ExitCode>

const wrapCommandHandler = (handler: Handler) =>
  function (args: yargs.Arguments) {
    if (args.debug) {
      process.env.DEBUG = 'true';
      setLogLevel('debug');
    }
    handler(args)
      .then(process.exit)
      .catch(error => {
        if (error.message) {
          logger.error(error.message);
        }
        if (debug()) {
          logger.error(error);
        }
        process.exit(1);
      });
  };

// lazy load the actual command fns to make bash command completion faster
export interface Commands {
  createStackMain: Handler
  updateStackMain: Handler
  listStacksMain: Handler
  watchStackMain: Handler
  describeStackMain: Handler
  getStackTemplateMain: Handler
  getStackInstancesMain: Handler
  deleteStackMain: Handler

  estimateCost: Handler // TODO fix inconsistent name

  createUpdateChangesetMain: Handler
  createCreationChangesetMain: Handler
  executeChangesetMain: Handler

  renderMain: Handler,
  demoMain: Handler
  // TODO add an activate stack command wrapper

};

// TODO: Investigate this again if we can use webpack to shrinkwrap
// import * as index from './index';
// const nonLazy: Commands = {
//   createStackMain: index.createStackMain,
//   updateStackMain: index.updateStackMain,
//   listStacksMain: index.listStacksMain,
//   watchStackMain: index.watchStackMain,
//   describeStackMain: index.describeStackMain,

//   createUpdateChangesetMain: index.createUpdateChangesetMain,
//   createCreationChangesetMain: index.createCreationChangesetMain,
//   executeChangesetMain: index.executeChangesetMain,

//   renderMain: index.renderMain,

//   estimateCost: index.estimateCost
// }

type LazyLoadModules = './cfn' | './index' | './demo'

const lazyLoad = (fnname: keyof Commands, modName: LazyLoadModules='./cfn'): Handler =>
  (args) => {
    // note, the requires must be literal for `pkg` to find the modules to include
    if (modName === './index') {
      return require('./index')[fnname](args);
    } else if (modName === './cfn') {
      return require('./cfn')[fnname](args);
    } else if (modName === './demo') {
      return require('./demo')[fnname](args);
    }
  }

const lazy: Commands = {
  createStackMain: lazyLoad('createStackMain'),
  updateStackMain: lazyLoad('updateStackMain'),
  listStacksMain: lazyLoad('listStacksMain'),
  watchStackMain: lazyLoad('watchStackMain'),
  describeStackMain: lazyLoad('describeStackMain'),
  getStackTemplateMain: lazyLoad('getStackTemplateMain'),
  getStackInstancesMain: lazyLoad('getStackInstancesMain'),
  deleteStackMain: lazyLoad('deleteStackMain'),

  createUpdateChangesetMain: lazyLoad('createUpdateChangesetMain'),
  createCreationChangesetMain: lazyLoad('createCreationChangesetMain'),
  executeChangesetMain: lazyLoad('executeChangesetMain'),

  renderMain: lazyLoad('renderMain', './index'),

  estimateCost: lazyLoad('estimateCost'),

  demoMain: lazyLoad('demoMain', './demo'),

  // TODO init-stack-args command to create a stack-args.yaml
  // TODO example command pull down an examples dir

};

export function buildArgs(commands=lazy, wrapMainHandler=wrapCommandHandler) {
  const description = cli.xterm(250);
  const usage = (`${cli.bold(cli.green('iidy'))} - ${cli.green('CloudFormation with Confidence')}`
                 + ` ${' '.repeat(18)} ${cli.blackBright('An acronym for "Is it done yet?"')}`);

  return yargs
    .env('IIDY')
    .command(
      'create-stack  <argsfile>',
      description('create a cfn stack based on stack-args.yaml'),
      (args) => args
        .demandCommand(0, 0)
        .usage('Usage: iidy create-stack <stack-args.yaml>')
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.createStackMain))

    .command(
      'update-stack  <argsfile>',
      description('update a cfn stack based on stack-args.yaml'),
      (args) => args
        .demandCommand(0, 0)
        .usage('Usage: iidy update-stack <stack-args.yaml>')
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.updateStackMain))

    .command(
      'estimate-cost <argsfile>',
      description('estimate aws costs based on stack-args.yaml'),
      (args) => args
        .demandCommand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.estimateCost))

    .command('\t', '') // fake command to add a line-break to the help output

    .command(
      'create-changeset           <changesetName> <argsfile>',
      description('create a cfn changeset based on stack-args.yaml'),
      (args) => args
        .demandCommand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.createUpdateChangesetMain))

    .command(
      'exec-changeset             <changesetName> <argsfile>',
      description('execute a cfn changeset based on stack-args.yaml'),
      (args) => args
        .demandCommand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.executeChangesetMain))

    .command(
      'create-stack-via-changeset <changesetName> <argsfile>',
      description('create a cfn changeset to create a new stack'),
      (args) => args
        .demandCommand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.createCreationChangesetMain))

    .command('\t', '') // fake command to add a line-break to the help output


    .command(
      'describe-stack     <stackname>',
      description('describe a stack'),
      (args) => args
        .demandCommand(0, 0)
        .option('events', {
          type: 'number', default: 50,
          description: 'how many stack events to display'})
        .usage('Usage: iidy describe-stack <stackname>'),
      wrapMainHandler(commands.describeStackMain))

    .command(
      'watch-stack        <stackname>',
      description('watch a stack that is already being created or updated'),
      (args) => args
        .demandCommand(0, 0)
        .usage('Usage: iidy watch-stack <stackname>'),
      wrapMainHandler(commands.watchStackMain))

    .command(
      'delete-stack       <stackname>',
      description('delete a stack (after confirmation)'),
      (args) => args
        .demandCommand(0, 0)
        .option('role-arn', {
          type: 'string',
          description: 'Role to assume for delete operation'})
        .option('yes', {
          type: 'boolean', default: false,
          description: 'Confirm deletion of stack'})
        .usage('Usage: iidy delete-stack <stackname>'),
      wrapMainHandler(commands.deleteStackMain))

    .command(
      'get-stack-template <stackname>',
      description('download the template of a live stack'),
      (args) => args
        .demandCommand(0, 0)
        .option('format', {
          type: 'string', default: 'original',
          choices: ['original', 'yaml', 'json'],
          description: 'Template stage to show'})
        .option('stage', {
          type: 'string', default: 'Original',
          choices: ['Original', 'Processed'],
          description: 'Template stage to show'})
        .usage('Usage: iidy get-stack-template <stackname>'),
      wrapMainHandler(commands.getStackTemplateMain))

    .command(
      'get-stack-instances <stackname>',
      description('list the ec2 instances of a live stack'),
      (args) => args
        .demandCommand(0, 0)
        .option('short', {
          type: 'boolean', default: false,
          description: 'Show only instance dns names'})
        .usage('Usage: iidy get-stack-instances <stackname>'),
      wrapMainHandler(commands.getStackInstancesMain))

    .command(
      'list-stacks',
      description('list all stacks within a region'),
      (args) => args.demandCommand(0, 0),
      wrapMainHandler(commands.listStacksMain))

    .command('\t', '') // fake command to add a line-break to the help output

    .command(
      'render <template>',
      description('pre-process and render cloudformation yaml template'),
      (args) => args
        .demandCommand(0, 0)
        .usage('Usage: iidy render <input-template.yaml>')
        .option('outfile', {
          type: 'string', default: 'stdout',
          description: 'yaml input template to preprocess'})
        .option('overwrite', {
          type: 'boolean', default: false,
          description: 'Whether to overwrite an existing <outfile>.'
        })
        .strict(),
      wrapMainHandler(commands.renderMain))

    .command(
      'demo <demoscript>',
      description('run a demo script'),
      (args) => args
        .demandCommand(0, 0)
        .option('timescaling', {
          type: 'number', default: 1,
          description: 'time scaling factor for sleeps, etc.'})
        .strict(),
      wrapMainHandler(commands.demoMain))

    .option('region', {
      type: 'string', default: null,
      group: 'AWS Options',
      description: 'AWS region'})
    .option('profile', {
      type: 'string', default: null,
      group: 'AWS Options',
      description: 'AWS profile'})

    .option('debug', {
      type: 'boolean', default: false,
      description: 'Log debug information to stderr.'})

    .demandCommand(1)
    .usage(usage)
    .alias('v', 'version')
    .version(function() { return require('../package').version;})
    .describe('v', 'show version information')
    .help()
    .alias('h', 'help')
    .completion('completion', description('generate bash completion script. To use: "source <(iidy completion)"'))
    .recommendCommands()
    // .completion('completion', (current, argv, done) => {
    //   console.log('-----')
    //   console.log(current);
    //   console.log('-----')
    //   console.log(argv);
    //   return []//yargs.getCompletion(argv, done)
    // })

    .strict()
    .wrap(yargs.terminalWidth());
}

export async function main(commands=lazy) {
  // called for side-effect to force parsing / handling
  buildArgs(commands).argv;
}


if (module.parent === null) {
  main();
};
