import * as process from 'process';
// We need to set this early because of https://github.com/aws/aws-sdk-js/pull/1391
process.env.AWS_SDK_LOAD_CONFIG = '1';
// Use bluebird promises globally. We need to load this prior to 'aws-sdk'
import * as bluebird from 'bluebird';
global.Promise = bluebird;

import * as yargs from 'yargs';
import * as cli from 'cli-color';

import {logger, setLogLevel} from './logger';
import debug from './debug';
import {AWSRegion} from './aws-regions';
import {buildParamCommands} from './params/cli'

export interface GlobalArguments {
  region?: AWSRegion;
  profile?: string;
  debug?: boolean;
}

export type ExitCode = number;
export type Handler = (args: GlobalArguments) => Promise<ExitCode>

export const wrapCommandHandler = (handler: Handler) =>
  function(args: GlobalArguments & yargs.Arguments) {
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

export interface CfnStackCommands {
  createStackMain: Handler;
  updateStackMain: Handler;
  listStacksMain: Handler;
  watchStackMain: Handler;
  describeStackMain: Handler;
  getStackTemplateMain: Handler;
  getStackInstancesMain: Handler;
  deleteStackMain: Handler;

  estimateCost: Handler; // TODO fix inconsistent name

  createUpdateChangesetMain: Handler;
  createCreationChangesetMain: Handler;
  executeChangesetMain: Handler;
  // TODO add an activate stack command wrapper
}

export interface MiscCommands {
  renderMain: Handler;
  demoMain: Handler;
}

export interface Commands extends CfnStackCommands, MiscCommands {};

// We lazy load the actual command fns to make bash command completion
// faster. See the git history of this file to see the non-lazy form.
// Investigate this again if we can use babel/webpack to shrinkwrap

type LazyLoadModules = './cfn' | './index' | './demo' | './render';
const lazyLoad = (fnname: keyof Commands, modName: LazyLoadModules = './cfn'): Handler =>
  (args) => {
    // note, the requires must be literal for `pkg` to find the modules to include
    if (modName === './index') {
      return require('./index')[fnname](args);
    } else if (modName === './cfn') {
      return require('./cfn')[fnname](args);
    } else if (modName === './demo') {
      return require('./demo')[fnname](args);
    } else if (modName === './render') {
      return require('./render')[fnname](args);
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

  renderMain: lazyLoad('renderMain', './render'),

  estimateCost: lazyLoad('estimateCost'),

  demoMain: lazyLoad('demoMain', './demo'),
  // TODO init-stack-args command to create a stack-args.yaml
  // TODO example command pull down an examples dir

};

export const description = cli.xterm(250);

const environmentOpt: yargs.Options = {
  type: 'string', default: null,
  alias: 'e',
  description: description('used to load environment based settings: AWS Profile, Region, etc.')
};

const stackNameOpt: yargs.Options = {
  type: 'string', default: null,
  alias: 's',
  description: description('override the StackName from <argsfile>')
};


export function buildArgs(commands = lazy, wrapMainHandler = wrapCommandHandler) {
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
      .option('stack-name', stackNameOpt),
    wrapMainHandler(commands.createStackMain))

    .command(
    'update-stack  <argsfile>',
    description('update a cfn stack based on stack-args.yaml'),
    (args) => args
      .demandCommand(0, 0)
      .usage('Usage: iidy update-stack <stack-args.yaml>')
      .option('stack-name', stackNameOpt)
      .option('stack-policy-during-update', {
        type: 'string', default: null,
        description: 'override original stack-policy for this update only'
      }),
    wrapMainHandler(commands.updateStackMain))

    .command(
    'estimate-cost <argsfile>',
    description('estimate aws costs based on stack-args.yaml'),
    (args) => args
      .demandCommand(0, 0)
      .option('stack-name', stackNameOpt),
    wrapMainHandler(commands.estimateCost))

    .command('\t', '') // fake command to add a line-break to the help output

    .command(
    'create-changeset           <argsfile> [changesetName]',
    description('create a cfn changeset based on stack-args.yaml'),
    (args) => args
      .demandCommand(0, 0)
      .option('description', {
        type: 'string', default: undefined,
        description: 'optional description of changeset'
      })
      .option('stack-name', stackNameOpt),
    wrapMainHandler(commands.createUpdateChangesetMain))

    .command(
    'exec-changeset             <argsfile> <changesetName>',
    description('execute a cfn changeset based on stack-args.yaml'),
    (args) => args
      .demandCommand(0, 0)
      .option('stack-name', stackNameOpt),
    wrapMainHandler(commands.executeChangesetMain))

    .command(
    'create-stack-via-changeset <argsfile>',
    description('create a cfn changeset to create a new stack'),
    (args) => args
      .demandCommand(0, 0)
      .option('changeset-name', {
        type: 'string', default: 'initial',
        description: 'name for initial changeset'
      })
      .option('stack-name', stackNameOpt),
    wrapMainHandler(commands.createCreationChangesetMain))

    .command('\t', '') // fake command to add a line-break to the help output


    .command(
    'describe-stack      <stackname>',
    description('describe a stack'),
    (args) => args
      .demandCommand(0, 0)
      .option('events', {
        type: 'number', default: 50,
        description: 'how many stack events to display'
      })
      .usage('Usage: iidy describe-stack <stackname>'),
    wrapMainHandler(commands.describeStackMain))

    .command(
    'watch-stack         <stackname>',
    description('watch a stack that is already being created or updated'),
    (args) => args
      .demandCommand(0, 0)
      .usage('Usage: iidy watch-stack <stackname>'),
    wrapMainHandler(commands.watchStackMain))

    .command(
    'delete-stack        <stackname>',
    description('delete a stack (after confirmation)'),
    (args) => args
      .demandCommand(0, 0)
      .option('role-arn', {
        type: 'string',
        description: 'Role to assume for delete operation'
      })
      .option('retain-resources', {
        type: 'string',
        array: true,
        description: 'For stacks in the DELETE_FAILED, list of logical resource ids to retain'
      })
      .option('yes', {
        type: 'boolean', default: false,
        description: 'Confirm deletion of stack'
      })
      .usage('Usage: iidy delete-stack <stackname>'),
    wrapMainHandler(commands.deleteStackMain))

    .command(
    'get-stack-template  <stackname>',
    description('download the template of a live stack'),
    (args) => args
      .demandCommand(0, 0)
      .option('format', {
        type: 'string', default: 'original',
        choices: ['original', 'yaml', 'json'],
        description: 'Template stage to show'
      })
      .option('stage', {
        type: 'string', default: 'Original',
        choices: ['Original', 'Processed'],
        description: 'Template stage to show'
      })
      .usage('Usage: iidy get-stack-template <stackname>'),
    wrapMainHandler(commands.getStackTemplateMain))

    .command(
    'get-stack-instances <stackname>',
    description('list the ec2 instances of a live stack'),
    (args) => args
      .demandCommand(0, 0)
      .option('short', {
        type: 'boolean', default: false,
        description: 'Show only instance dns names'
      })
      .usage('Usage: iidy get-stack-instances <stackname>'),
    wrapMainHandler(commands.getStackInstancesMain))

    .command(
    'list-stacks',
    description('list all stacks within a region'),
    (args) => args
      .demandCommand(0, 0)
      .option('tag-filter', {
        type: 'string', default: [],
        array: true,
        description: 'Filter by tags: key=value'
      })
      .option('tags', {
        type: 'boolean', default: false,
        description: 'Show stack tags'
      }),
    wrapMainHandler(commands.listStacksMain))

    .command('\t', '') // fake command to add a line-break to the help output

    .command('param',
    description('sub commands for working with AWS SSM Parameter Store'),
    buildParamCommands)

    .command('\t', '') // fake command to add a line-break to the help output

    .command(
    'render <template>',
    description('pre-process and render yaml template'),
    (args) => args
      .demandCommand(0, 0)
      .usage('Usage: iidy render <input-template.yaml>')
      .option('outfile', {
        type: 'string', default: 'stdout',
        description: 'yaml input template to preprocess'
      })
      .option('overwrite', {
        type: 'boolean', default: false,
        description: 'Whether to overwrite an existing <outfile>.'
      })
      .strict(),
    wrapMainHandler(commands.renderMain))

    .command(
    'demo   <demoscript>',
    description('run a demo script'),
    (args) => args
      .demandCommand(0, 0)
      .option('timescaling', {
        type: 'number', default: 1,
        description: 'time scaling factor for sleeps, etc.'
      })
      .strict(),
    wrapMainHandler(commands.demoMain))

    .option('environment', environmentOpt)
    .option('client-request-token', {
      type: 'string', default: null,
      group: 'AWS Options',
      description: description('a unique, case-sensitive string of up to 64 ASCII characters used to ensure idempotent retries.')
    })
    .option('region', {
      type: 'string', default: null,
      group: 'AWS Options',
      description: description('AWS region. Can also be set via --environment & stack-args.yaml:Region.')
    })
    .option('profile', {
      type: 'string', default: null,
      group: 'AWS Options',
      description: description('AWS profile. Can also be set via --environment & stack-args.yaml:Profile.')
    })

    .option('debug', {
      type: 'boolean', default: false,
      description: description('log debug information to stderr.')
    })
    .command('\t', '') // fake command to add a line-break to the help output

    .demandCommand(1)
    .usage(usage)
    .version(() => require('../package').version)
    .alias('v', 'version')
    .describe('version', description('show version information'))
    .help('help', description('show help'))
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

export async function main(commands = lazy) {
  // called for side-effect to force parsing / handling
  buildArgs(commands).argv;
}


if (module.parent === null) {
  main();
};
