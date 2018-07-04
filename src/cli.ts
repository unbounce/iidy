import * as path from 'path';
import * as fs from 'fs';
import * as process from 'process';

const awsUserDir = process.env.HOME ? path.join(process.env.HOME as string, '.aws') : null;
if (awsUserDir && fs.existsSync(awsUserDir)) {
  // We need to set this early because of https://github.com/aws/aws-sdk-js/pull/1391
  // We also set this env-var in the main cli entry-point
  process.env.AWS_SDK_LOAD_CONFIG = '1'; // see https://github.com/aws/aws-sdk-js/pull/1391
  // Note:
  // if this is set and ~/.aws doesn't exist we run into issue #17 as soon as the sdk is loaded:
  //  Error: ENOENT: no such file or directory, open '.../.aws/credentials
}

// Use bluebird promises globally. We need to load this prior to 'aws-sdk'
import * as bluebird from 'bluebird';
global.Promise = bluebird;

import * as yargs from 'yargs';
import * as cli from 'cli-color';

import {logger, setLogLevel} from './logger';
import debug from './debug';
import {AWSRegion} from './aws-regions';
import {buildParamCommands} from './params/cli'
import {buildApprovalCommands} from './approval/cli'

export interface GlobalArguments {
  region?: AWSRegion;
  profile?: string;
  assumeRoleArn?: string;
  debug?: boolean;
  environment: string;
  clientRequestToken?: string;
}

export type ExitCode = number;
export type Handler = (args: GlobalArguments & yargs.Arguments) => Promise<ExitCode>

export const wrapCommandHandler = (handler: Handler) =>
  function(args0: yargs.Arguments) {
    const args: GlobalArguments & yargs.Arguments = args0 as any; // coerce type
    if (!args.environment) {
      args.environment = 'development';
    }
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
        if (debug() || process.env.LOG_IIDY_ERROR) {
          logger.error(error);
        }
        process.exit(1);
      });
  };

export interface CfnStackCommands {
  createStackMain: Handler;
  createOrUpdateStackMain: Handler;
  updateStackMain: Handler;
  listStacksMain: Handler;
  watchStackMain: Handler;
  describeStackMain: Handler;
  getStackTemplateMain: Handler;
  getStackInstancesMain: Handler;
  deleteStackMain: Handler;

  estimateCost: Handler; // TODO fix inconsistent name

  createChangesetMain: Handler;
  executeChangesetMain: Handler;
  // TODO add an activate stack command wrapper
}

export interface MiscCommands {
  initStackArgs: Handler;
  renderMain: Handler;
  demoMain: Handler;
  convertStackToIIDY: Handler;
}

export interface Commands extends CfnStackCommands, MiscCommands {};

// We lazy load the actual command fns to make bash command completion
// faster. See the git history of this file to see the non-lazy form.
// Investigate this again if we can use babel/webpack to shrinkwrap

type LazyLoadModules = './cfn' | './cfn/convertStackToIidy' | './preprocess' | './demo' | './render' | './initStackArgs';
const lazyLoad = (fnname: keyof Commands, modName: LazyLoadModules = './cfn'): Handler =>
  (args) => {
    // note, the requires must be literal for `pkg` to find the modules to include
    if (modName === './preprocess') {
      return require('./preprocess')[fnname](args);
    } else if (modName === './cfn') {
      return require('./cfn')[fnname](args);
    } else if (modName === './cfn/convertStackToIidy') {
      return require('./cfn/convertStackToIidy')[fnname](args);
    } else if (modName === './demo') {
      return require('./demo')[fnname](args);
    } else if (modName === './render') {
      return require('./render')[fnname](args);
    } else if (modName === './initStackArgs') {
      return require('./initStackArgs')[fnname](args);
    }
  }

const lazy: Commands = {
  createStackMain: lazyLoad('createStackMain'),
  createOrUpdateStackMain: lazyLoad('createOrUpdateStackMain'),
  updateStackMain: lazyLoad('updateStackMain'),
  listStacksMain: lazyLoad('listStacksMain'),
  watchStackMain: lazyLoad('watchStackMain'),
  describeStackMain: lazyLoad('describeStackMain'),
  getStackTemplateMain: lazyLoad('getStackTemplateMain'),
  getStackInstancesMain: lazyLoad('getStackInstancesMain'),
  deleteStackMain: lazyLoad('deleteStackMain'),

  createChangesetMain: lazyLoad('createChangesetMain'),
  executeChangesetMain: lazyLoad('executeChangesetMain'),

  renderMain: lazyLoad('renderMain', './render'),

  estimateCost: lazyLoad('estimateCost'),

  demoMain: lazyLoad('demoMain', './demo'),
  convertStackToIIDY: lazyLoad('convertStackToIIDY', './cfn/convertStackToIidy'),
  initStackArgs: lazyLoad('initStackArgs', './initStackArgs'),
  // TODO example command pull down an examples dir

};

export const description = cli.xterm(250);

const environmentOpt: yargs.Options = {
  type: 'string', default: 'development',
  alias: 'e',
  description: description('used to load environment based settings: AWS Profile, Region, etc.')
};

const stackNameOpt: yargs.Options = {
  type: 'string', default: null,
  alias: 's',
  description: description('override the StackName from <argsfile>')
};

const fakeCommandSeparator = `\b\b\b\b\b     ${cli.black('...')}`;
// ^ the \b's are ansi backspace control chars to delete 'iidy' from
// help output on these fake commands. This allows us to visually
// separate the iidy help output into sets of commands.

export function buildArgs(commands = lazy, wrapMainHandler = wrapCommandHandler) {
  const usage = (`${cli.bold(cli.green('iidy'))} - ${cli.green('CloudFormation with Confidence')}`
    + ` ${' '.repeat(18)} ${cli.blackBright('An acronym for "Is it done yet?"')}`);
  const epilogue = ('Status Codes:\n'
    + '  Success (0)       Command successfully completed\n'
    + '  Error (1)         An error was encountered while executing command\n'
    + '  Cancelled (130)   User responded \'No\' to iidy prompt or interrupt (CTRL-C) was received');

  return yargs
    .env('IIDY')
    .command(
    'create-stack     <argsfile>',
    description('create a cfn stack based on stack-args.yaml'),
    (args) => args
      .demandCommand(0, 0)
      .usage('Usage: iidy create-stack <stack-args.yaml>')
      .option('stack-name', stackNameOpt),
    wrapMainHandler(commands.createStackMain))

    .command(
    'update-stack     <argsfile>',
    description('update a cfn stack based on stack-args.yaml'),
    (args) => args
      .demandCommand(0, 0)
      .usage('Usage: iidy update-stack <stack-args.yaml>')
      .option('stack-name', stackNameOpt)
      .option('changeset', {
        type: 'boolean', default: false,
        description: description('review & confirm changes via a changeset')
      })
      .option('yes', {
        type: 'boolean', default: false,
        description: description('Confirm and execute changeset if --changeset option is used')
      })
      .option('diff', {
        type: 'boolean', default: true,
        description: description('diff & review changes to the template body as part of changeset review')
      })
      .option('stack-policy-during-update', {
        type: 'string', default: null,
        description: description('override original stack-policy for this update only')
      }),
    wrapMainHandler(commands.updateStackMain))

    .command(
    'create-or-update <argsfile>',
    description('create or update a cfn stack based on stack-args.yaml'),
    (args) => args
      .demandCommand(0, 0)
      .usage('Usage: iidy create-or-update <stack-args.yaml>')
      .option('stack-name', stackNameOpt)
      .option('changeset', {
        type: 'boolean', default: false,
        description: description('review & confirm changes via a changeset')
      })
      .option('yes', {
        type: 'boolean', default: false,
        description: description('Confirm and execute changeset if --changeset option is used')
      })
      .option('diff', {
        type: 'boolean', default: true,
        description: description('diff & review changes to the template body as part of changeset review')
      })
      .option('stack-policy-during-update', {
        type: 'string', default: null,
        description: description('override original stack-policy for this update only')
      }),
    wrapMainHandler(commands.createOrUpdateStackMain))

    .command(
    'estimate-cost    <argsfile>',
    description('estimate aws costs based on stack-args.yaml'),
    (args) => args
      .demandCommand(0, 0)
      .option('stack-name', stackNameOpt),
    wrapMainHandler(commands.estimateCost))

    .command(fakeCommandSeparator, '')

    .command(
    'create-changeset           <argsfile> [changesetName]',
    description('create a cfn changeset based on stack-args.yaml'),
    (args) => args
      .demandCommand(0, 0)
      .option('watch', {
        type: 'boolean', default: false,
        description: description('Watch stack after creating changeset. This is useful when exec-changeset is called by others.')
      })
      .option('watch-inactivity-timeout', {
        type: 'number', default: (60 * 3),
        description: description('how long to wait for events when the stack is in a terminal state')
      })
      .option('description', {
        type: 'string', default: undefined,
        description: description('optional description of changeset')
      })
      .option('stack-name', stackNameOpt),
    wrapMainHandler(commands.createChangesetMain))

    .command(
    'exec-changeset             <argsfile> <changesetName>',
    description('execute a cfn changeset based on stack-args.yaml'),
    (args) => args
      .demandCommand(0, 0)
      .option('stack-name', stackNameOpt),
    wrapMainHandler(commands.executeChangesetMain))

    .command(fakeCommandSeparator, '')

    .command(
    'describe-stack      <stackname>',
    description('describe a stack'),
    (args) => args
      .demandCommand(0, 0)
      .option('events', {
        type: 'number', default: 50,
        description: description('how many stack events to display')
      })
      .option('query', {
        type: 'string', default: null,
        description: description('jmespath search query to select a subset of the output')
      })
      .usage('Usage: iidy describe-stack <stackname-or-argsfile>'),
    wrapMainHandler(commands.describeStackMain))

    .command(
    'watch-stack         <stackname>',
    description('watch a stack that is already being created or updated'),
    (args) => args
      .demandCommand(0, 0)
      .option('inactivity-timeout', {
        type: 'number', default: (60 * 3),
        description: description('how long to wait for events when the stack is in a terminal state')
      })
      .usage('Usage: iidy watch-stack <stackname-or-argsfile>'),
    wrapMainHandler(commands.watchStackMain))

    .command(
    'delete-stack        <stackname>',
    description('delete a stack (after confirmation)'),
    (args) => args
      .demandCommand(0, 0)
      .option('role-arn', {
        type: 'string',
        description: description('Role to assume for delete operation')
      })
      .option('retain-resources', {
        type: 'string',
        array: true,
        description: description('For stacks in the DELETE_FAILED, list of logical resource ids to retain')
      })
      .option('yes', {
        type: 'boolean', default: false,
        description: description('Confirm deletion of stack')
      })
      .option('fail-if-absent', {
        type: 'boolean', default: false,
        description: description('Fail if stack is absent (exit code = 1). Default is to tolerate absence.')
      })
      .usage('Usage: iidy delete-stack <stackname-or-argsfile>'),
    wrapMainHandler(commands.deleteStackMain))

    .command(
    'get-stack-template  <stackname>',
    description('download the template of a live stack'),
    (args) => args
      .demandCommand(0, 0)
      .option('format', {
        type: 'string', default: 'original',
        choices: ['original', 'yaml', 'json'],
        description: description('Template stage to show')
      })
      .option('stage', {
        type: 'string', default: 'Original',
        choices: ['Original', 'Processed'],
        description: description('Template stage to show')
      })
      .usage('Usage: iidy get-stack-template <stackname-or-argsfile>'),
    wrapMainHandler(commands.getStackTemplateMain))

    .command(
    'get-stack-instances <stackname>',
    description('list the ec2 instances of a live stack'),
    (args) => args
      .demandCommand(0, 0)
      .option('short', {
        type: 'boolean', default: false,
        description: description('Show only instance dns names')
      })
      .usage('Usage: iidy get-stack-instances <stackname-or-argsfile>'),
    wrapMainHandler(commands.getStackInstancesMain))

    .command(
    'list-stacks',
    description('list all stacks within a region'),
    (args) => args
      .demandCommand(0, 0)
      .option('tag-filter', {
        type: 'string', default: [],
        array: true,
        description: description('Filter by tags: key=value')
      })
      .option('jmespath-filter', {
        type: 'string', default: null,
        description: description('jmespath search query to select a subset of the stacks')
      })
      .option('query', {
        type: 'string', default: null,
        description: description('jmespath search query to select a subset of the output')
      })
      .option('tags', {
        type: 'boolean', default: false,
        description: description('Show stack tags')
      }),
    wrapMainHandler(commands.listStacksMain))

    .command(fakeCommandSeparator, '')

    .command('param',
    description('sub commands for working with AWS SSM Parameter Store'),
    buildParamCommands)

    .command(fakeCommandSeparator, '')

    .command('template-approval',
    description('sub commands for template approval'),
    buildApprovalCommands)

    .command(fakeCommandSeparator, '')

    .command(
    'render <template>',
    description('pre-process and render yaml template'),
    (args) => args
      .demandCommand(0, 0)
      .usage('Usage: iidy render <input-template.yaml>')
      .option('outfile', {
        type: 'string', default: 'stdout',
        description: description('yaml input template to preprocess')
      })
      .option('format', {
        type: 'string', default: 'yaml',
        choices: ['yaml', 'json'],
        description: description('output serialization syntax')
      })
      .option('query', {
        type: 'string', default: null,
        description: description('jmespath search query to select a subset of the output')
      })
      .option('overwrite', {
        type: 'boolean', default: false,
        description: description('Whether to overwrite an existing <outfile>.')
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
        description: description('time scaling factor for sleeps, etc.')
      })
      .strict(),
    wrapMainHandler(commands.demoMain))

    .command(
    'convert-stack-to-iidy <stackname> <outputDir>',
    description('create an iidy project directory from an existing CFN stack'),
    (args) => args
      .demandCommand(0, 0)
      .option('move-params-to-ssm', {
        type: 'boolean', default: false,
        description: description('automatically create an AWS SSM parameter namespace populated with the stack Parameters')
      })
      .option('sortkeys', {
        type: 'boolean', default: true,
        description: description('sort keys in cloudformation maps')
      })
      .option('project', {
        type: 'string', default: null,
        description: description('The name of the project (service or app). If not specified the "project" Tag is checked.')
      }),
    wrapMainHandler(commands.convertStackToIIDY))

    .command(
    'init-stack-args',
    description('initialize stack-args.yaml and cfn-template.yaml'),
    (args) => args
      .demandCommand(0, 0)
      .option('force', {
        type: 'boolean', default: false,
        description: description('Overwrite the current stack-args.yaml and cfn-template.yaml')
      })
      .option('force-stack-args', {
        type: 'boolean', default: false,
        description: description('Overwrite the current stack-args.yaml')
      })
      .option('force-cfn-template', {
        type: 'boolean', default: false,
        description: description('Overwrite the current cfn-template.yaml')
      }),
    wrapMainHandler(commands.initStackArgs))

    .option('environment', environmentOpt)
    .option('client-request-token', {
      type: 'string', default: null,
      group: 'AWS Options:',
      description: description('a unique, case-sensitive string of up to 64 ASCII characters used to ensure idempotent retries.')
    })
    .option('region', {
      type: 'string', default: null,
      group: 'AWS Options:',
      description: description('AWS region. Can also be set via --environment & stack-args.yaml:Region.')
    })
    .option('profile', {
      type: 'string', default: null,
      group: 'AWS Options:',
      description: description(
        'AWS profile. Can also be set via --environment & stack-args.yaml:Profile. '
        + 'Use --profile=no-profile to override values in stack-args.yaml and use AWS_* env vars.')
    })
    .option('assume-role-arn', {
      type: 'string', default: null,
      group: 'AWS Options:',
      description: description(
        'AWS role. Can also be set via --environment & stack-args.yaml:AssumeRoleArn. '
          + 'This is mutually exclusive with --profile. '
          + 'Use --assume-role-arn=no-role to override values in stack-args.yaml and use AWS_* env vars.')
    })

    .option('debug', {
      type: 'boolean', default: false,
      description: description('log debug information to stderr.')
    })
    .command(fakeCommandSeparator, '')

    .demandCommand(1)
    .usage(usage)
    .version()
    .alias('v', 'version')
    .describe('version', description('show version information'))
    .help('help', description('show help'))
    .alias('h', 'help')
    .completion('completion', description('generate bash completion script. To use: "source <(iidy completion)"'))
    .recommendCommands()
    .epilogue(epilogue)
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
