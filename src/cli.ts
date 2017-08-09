import * as process from 'process';
import * as yargs from 'yargs';
import * as cli from 'cli-color';

import {logger} from './logger';
import {AWSRegions} from './aws-regions';

type ExitCode = number;
type Handler = (args:yargs.Arguments) => Promise<ExitCode>

const wrapMainHandler = (handler: Handler) =>
  // move the configureaws step into here
  function (args: yargs.Arguments) {
    handler(args)
      .then(exitCode => process.exit(exitCode))
      .catch(error => {
        if (error.message) {
          logger.error(error.message);
        }
        logger.error(error);
        process.exit(1);
      });
  };

// lazy load the actual command fns to make bash command completion faster
interface Commands {
  createStackMain: Handler
  updateStackMain: Handler
  listStacksMain: Handler
  watchStackMain: Handler
  describeStackMain: Handler
  getStackTemplateMain: Handler
  deleteStackMain: Handler

  estimateCost: Handler

  createUpdateChangesetMain: Handler
  createCreationChangesetMain: Handler
  executeChangesetMain: Handler

  renderMain: Handler,
  demoMain: Handler

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

type LazyLoadModules = './index' | './demo'

const lazyLoad = (fnname: keyof Commands, modName: LazyLoadModules='./index'): Handler =>
  (args) => {
    // note, the requires must be literal for `pkg` to find the modules to include
    if (modName === './index') {
      return require('./index')[fnname](args);
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
  deleteStackMain: lazyLoad('deleteStackMain'),

  createUpdateChangesetMain: lazyLoad('createUpdateChangesetMain'),
  createCreationChangesetMain: lazyLoad('createCreationChangesetMain'),
  executeChangesetMain: lazyLoad('executeChangesetMain'),

  renderMain: lazyLoad('renderMain'),

  estimateCost: lazyLoad('estimateCost'),

  demoMain: lazyLoad('demoMain', './demo'),

  // TODO init-stack-args command to create a stack-args.yaml
  // TODO example command pull down an examples dir

};

const commands: Commands = lazy;

export async function main() {
  const description = cli.xterm(250);
  const usage = (`${cli.bold(cli.green('iidy'))} - ${cli.green('CloudFormation with Confidence')}`
                 + ` ${' '.repeat(18)} ${cli.blackBright('An acronym for "Is it done yet?"')}`);

  const args = yargs
    .command(
      'create-stack  <argsfile>',
      description('create a cfn stack based on stack-args.yaml'),
      (yargs) => yargs
        .demand(0, 0)
        .usage('Usage: iidy create-stack <stack-args.yaml>')
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.createStackMain))

    .command(
      'update-stack  <argsfile>',
      description('update a cfn stack based on stack-args.yaml'),
      (yargs) => yargs
        .demand(0, 0)
        .usage('Usage: iidy update-stack <stack-args.yaml>')
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.updateStackMain))

    .command(
      'estimate-cost <argsfile>',
      description('estimate aws costs based on stack-args.yaml'),
      (yargs) => yargs
        .demand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.estimateCost))

    .command('\t', '') // fake command to add a line-break to the help output
  
    .command(
      'create-changeset           <changesetName> <argsfile>',
      description('create a cfn changeset based on stack-args.yaml'),
      (yargs) => yargs
        .demand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.createUpdateChangesetMain))

    .command(
      'exec-changeset             <changesetName> <argsfile>',
      description('execute a cfn changeset based on stack-args.yaml'),
      (yargs) => yargs
        .demand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.executeChangesetMain))

    .command(
      'create-stack-via-changeset <changesetName> <argsfile>',
      description('create a cfn changeset to create a new stack'),
      (yargs) => yargs
        .demand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.createCreationChangesetMain))

    .command('\t', '') // fake command to add a line-break to the help output


    .command(
      'describe-stack     <stackname>',
      description('describe a stack'),
      (yargs) => yargs
        .demand(0, 0)
        .option('events', {
          type: 'number', default: 50,
          description: 'how many stack events to display'})
        .usage('Usage: iidy describe-stack <stackname>'),
      wrapMainHandler(commands.describeStackMain))

    .command(
      'watch-stack        <stackname>',
      description('watch a stack that is already being created or updated'),
      (yargs) => yargs
        .demand(0, 0)
        .usage('Usage: iidy watch-stack <stackname>'),
      wrapMainHandler(commands.watchStackMain))

    .command(
      'delete-stack       <stackname>',
      description('delete a stack (after confirmation)'),
      (yargs) => yargs
        .demand(0, 0)
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
      (yargs) => yargs
        .demand(0, 0)
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
      'list-stacks',
      description('list all stacks within a region'),
      (yargs) => yargs.demand(0, 0),
      wrapMainHandler(commands.listStacksMain))

    .command('\t', '') // fake command to add a line-break to the help output

    .command(
      'render <template>',
      description('pre-process and render cloudformation yaml template'),
      (yargs) => yargs
        .demand(0, 0)
        .usage('Usage: iidy render <input-template.yaml>')
        .option('outfile', {
          type: 'string', default: '/dev/stdout',
          description: 'yaml input template to preprocess'})
        .strict(),
      wrapMainHandler(commands.renderMain))

    .command(
      'demo <demoscript>',
      description('run a demo script'),
      (yargs) => yargs
        .demand(0, 0)
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
    .wrap(yargs.terminalWidth())
    .argv; // to force parsing / handling

}


if (!module.parent) {
  // TODO add an activate stack command wrapper
  main();
};


// const openpgp: any = require('openpgp')
// import * as _ from 'lodash';
//   const keypair = await openpgp.generateKey(
//     {numBits:1024,
//      userIds:[{name:'Jon Smith', email:'jon@example.com' }],
//      //passphrase: 'test',
//      unlocked: true
//     });
//   console.log(keypair.privateKeyArmored.length);
//   //keypair.key.decrypt('test');
//   const options = {data: 'hello', privateKeys: keypair.key, detached: true};
//   const signed = await openpgp.sign(options);
//   console.log(signed.signature);
//   console.log('XXX', openpgp.cleartext.readArmored(signed.data))
//   const verifyOptions = {
//     signature: openpgp.signature.readArmored(signed.signature),
//     message: openpgp.message.fromText('hello'),
//     publicKeys:  openpgp.key.readArmored(keypair.publicKeyArmored).keys
//   };
//   console.log(await openpgp.verify(verifyOptions));
