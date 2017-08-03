import * as process from 'process';
import * as yargs from 'yargs';

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

  renderMain: Handler

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

const lazyLoad = (fnname: keyof Commands): Handler =>
  (args) => require('./index')[fnname](args);

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

  estimateCost: lazyLoad('estimateCost')

  // TODO init-stack-args command to create a stack-args.yaml
  // TODO example command pull down an examples dir

};

const commands: Commands = lazy;

export async function main() {

  const args = yargs
    .command(
      'create-stack <argsfile>',
      'create a cfn stack based on stack-args.yaml',
      (yargs) => yargs
        .demand(0, 0)
        .usage('Usage: iidy create-stack <stack-args.yaml>')
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.createStackMain))

    .command(
      'update-stack <argsfile>',
      'update a cfn stack based on stack-args.yaml',
      (yargs) => yargs
        .demand(0, 0)
        .usage('Usage: iidy update-stack <stack-args.yaml>')
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.updateStackMain))

    .command(
      'create-changeset <changesetName> <argsfile>',
      'create a cfn changeset based on stack-args.yaml',
      (yargs) => yargs
        .demand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.createUpdateChangesetMain))

    .command(
      'create-stack-via-changeset <changesetName> <argsfile>',
      'create a new stack via a cfn changeset based on stack-args.yaml',
      (yargs) => yargs
        .demand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.createCreationChangesetMain))

    .command(
      'exec-changeset <changesetName> <argsfile>',
      'execute a cfn changeset based on stack-args.yaml',
      (yargs) => yargs
        .demand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.executeChangesetMain))

    .command(
      'estimate-cost <argsfile>',
      'estimate stack costs based on stack-args.yaml',
      (yargs) => yargs
        .demand(0, 0)
        .option('stack-name', {
          type: 'string', default: null,
          description: 'override the StackName from --argsfile'}),
      wrapMainHandler(commands.estimateCost))

    .command(
      'watch-stack <stackname>',
      'watch a stack that is already being created or updated',
      (yargs) => yargs
        .demand(0, 0)
        .usage('Usage: iidy watch-stack <stackname>'),
      wrapMainHandler(commands.watchStackMain))

    .command(
      'describe-stack <stackname>',
      'describe a stack',
      (yargs) => yargs
        .demand(0, 0)
        .option('events', {
          type: 'number', default: 50,
          description: 'how many stack events to display'})
        .usage('Usage: iidy describe-stack <stackname>'),
      wrapMainHandler(commands.describeStackMain))

    .command(
      'get-stack-template <stackname>',
      'download the template of a live stack',
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
      'delete-stack <stackname>',
      'delete a stack (after confirmation)',
      (yargs) => yargs
        .demand(0, 0)
        .usage('Usage: iidy delete-stack <stackname>'),
      wrapMainHandler(commands.deleteStackMain))

    .command(
      'list-stacks',
      'list the stacks within a region',
      (yargs) => yargs.demand(0, 0),
      wrapMainHandler(commands.listStacksMain))

    .command(
      'render <template>',
      'pre-process and render cloudformation yaml template',
      (yargs) => yargs
        .demand(0, 0)
        .usage('Usage: iidy render <input-template.yaml>')
        .option('outfile', {
          type: 'string', default: '/dev/stdout',
          description: 'yaml input template to preprocess'})
        .strict(),
      wrapMainHandler(commands.renderMain))

    .option('region', {
      type: 'string', default: null,
      group: 'AWS Options',
      //choices: AWSRegions,
      description: 'AWS region'})
    .option('profile', {
      type: 'string', default: null,
      group: 'AWS Options',
      description: 'AWS profile'})
    .demandCommand(1)

    .usage("$ iidy (Is it done yet?) -- a tool for working with Yaml and the CloudFormation API")
    .alias('v', 'version')
    .version(function() { return require('../package').version;})
    .describe('v', 'show version information')
    .help()
    .alias('h', 'help')
    .completion()
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
    .argv;
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
