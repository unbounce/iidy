import * as _ from 'lodash';
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
import {Handler, description, fakeCommandSeparator, wrapCommandHandler, stackNameOpt, lintTemplateOpt} from './cli/utils';
import {Commands} from './cli/command-types';

// TODO bring these two in line with the new lazy load scheme
import {buildParamCommands} from './params/cli'
import {buildApprovalCommands} from './cfn/approval/cli'

// We lazy load the actual command fns to make bash command completion
// faster. See the git history of this file to see the non-lazy form.
// Investigate this again if we can use babel/webpack to shrinkwrap

function lazyLoad(fnname: keyof Commands): Handler {
  return (args) => {
    const {implementations} = require('./cli/command-implemntations');
    return implementations[fnname](args);
  }
}

function lazyGetter(target: any, key: keyof Commands) {
  Object.defineProperty(target, key, {value: lazyLoad(key)});
}

class LazyCommands implements Commands {
  @lazyGetter createStackMain: Handler
  @lazyGetter createOrUpdateStackMain: Handler
  @lazyGetter updateStackMain: Handler
  @lazyGetter listStacksMain: Handler
  @lazyGetter watchStackMain: Handler
  @lazyGetter describeStackMain: Handler
  @lazyGetter getStackTemplateMain: Handler
  @lazyGetter getStackInstancesMain: Handler
  @lazyGetter deleteStackMain: Handler
  @lazyGetter createChangesetMain: Handler
  @lazyGetter executeChangesetMain: Handler
  @lazyGetter lintMain: Handler
  @lazyGetter renderMain: Handler
  @lazyGetter estimateCost: Handler
  @lazyGetter demoMain: Handler
  @lazyGetter convertStackToIIDY: Handler
  @lazyGetter initStackArgs: Handler
}

const environmentOpt: yargs.Options = {
  type: 'string', default: 'development',
  alias: 'e',
  description: description('used to load environment based settings: AWS Profile, Region, etc.')
};

export function buildArgs(commands = new LazyCommands(), wrapMainHandler = wrapCommandHandler) {
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
        .option('stack-name', stackNameOpt)
        .option('lint-template', lintTemplateOpt(false)),
      wrapMainHandler(commands.createStackMain))

    .command(
      'update-stack     <argsfile>',
      description('update a cfn stack based on stack-args.yaml'),
      (args) => args
        .demandCommand(0, 0)
        .usage('Usage: iidy update-stack <stack-args.yaml>')
        .option('stack-name', stackNameOpt)
        .option('lint-template', lintTemplateOpt(false))
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
        .option('lint-template', lintTemplateOpt(false))
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

    // .command(
    //   'describe-stack-drift <stackname>',
    //   description('describe stack drift'),
    //   (args) => args
    //     .demandCommand(0, 0)
    //     .option('drift-cache', {
    //       type: 'number', default: (60 * 5),
    //       description: description('how long to cache previous drift detection results (seconds)')
    //     })
    //     .usage('Usage: iidy describe-stack-drift <stackname-or-argsfile>'),
    //   wrapMainHandler(commands.describeStackDriftMain))

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
            .positional('template', {
              description: 'template file to render, `-` for STDIN, can also be a directory of templates (will only render *.yml and *.yaml files in directory)'
            })
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
          'lint-template   <argsfile>',
          description('lint a CloudFormation template'),
          (args) => args
            .demandCommand(0, 0)
            .option('use-parameters', {
              type: 'boolean', default: false,
              description: description('use parameters to improve linting accuracy')
            })
            .strict(),
          wrapMainHandler(commands.lintMain))
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
        .option('log-full-error', {
          type: 'boolean', default: false,
          description: description('log full error information to stderr.')
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

export async function main() {
  // called for side-effect to force parsing / handling
  buildArgs().argv;
}


if (module.parent === null) {
  main();
};
