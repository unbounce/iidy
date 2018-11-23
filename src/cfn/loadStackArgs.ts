import * as aws from 'aws-sdk';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as pathmod from 'path';
import {GenericCLIArguments} from '../cli-util';
import configureAWS from '../configureAWS';
import getCurrentAWSRegion from '../getCurrentAWSRegion';
import {logger} from '../logger';
import {ExtendedCfnDoc, transform} from '../preprocess';
import * as yaml from '../yaml';
import {runCommandSet} from './runCommandSet';
import {StackArgs} from './types';
import {filter} from '../preprocess/filter';

function recursivelyMapValues<T extends object>(o: T, f: (a: any) => any): T {
  return _.mapValues(o, function(a: any) {
    if(_.isArray(a)) {
      return _.map(a, f);
    } else if(_.isObject(a)) {
      return recursivelyMapValues(a, f);
    } else {
      return f(a);
    }
  }) as T;
}

async function addDefaultNotificationArn(args: StackArgs): Promise<StackArgs> {
  const ssm = new aws.SSM();
  const ssmLookup = await ssm.getParameter(
    {Name: '/iidy/default-notification-arn', WithDecryption: true}).promise().catch(() => null);
  if (ssmLookup && ssmLookup.Parameter && ssmLookup.Parameter.Value) {
    const TopicArn = ssmLookup.Parameter.Value;
    const sns = new aws.SNS();
    if (await sns.getTopicAttributes({TopicArn}).promise().return(true).catchReturn(false)) {
      args.NotificationARNs = (args.NotificationARNs || []).concat(TopicArn);
    } else {
      logger.warn(
        `iidy's default NotificationARN set in this region is invalid: ${TopicArn}`);
    }
  }
  return args;
}

export async function _loadStackArgs(
  argsfile: string,
  argv: GenericCLIArguments,
  filterKeys: string[] = [],
  setupAWSCredentails = configureAWS)
: Promise<StackArgs> {
  const environment: string | undefined = argv.environment;
  const iidy_command = argv._.join(' ');
  let argsdata: any; // tslint:disable-line
  if (!fs.existsSync(argsfile)) {
    throw new Error(`stack args file "${argsfile}" not found`);
  }
  else if (pathmod.extname(argsfile) === '.json') {
    argsdata = JSON.parse(fs.readFileSync(argsfile).toString());
  }
  else if (_.includes(['.yaml', '.yml'], pathmod.extname(argsfile))) {
    argsdata = yaml.loadString(fs.readFileSync(argsfile), argsfile);
  }
  else {
    throw new Error(`Invalid stack args file "${argsfile}" extension`);
  }
  if(!_.isEmpty(filterKeys)) {
    argsdata = filter(filterKeys, argsdata, argsfile);
  }
  // There is chicken-and-egg situation between use of imports for
  // profile or region and the call to configureAWS. We need to
  // enforce that they be plain strings with no pre-processor magic.
  for (const key of ['Profile', 'AssumeRoleARN', 'Region']) {
    if (_.isObject(argsdata[key])) {
      if (environment && argsdata[key][environment]) {
        argsdata[key] = argsdata[key][environment];
        logger.debug(`resolving ${key}=${argsdata[key]} based on environment=${environment}`);
      }
      else {
        throw new Error(`environment "${environment}" not found in ${key} map: ${argsdata[key]}`);
      }
    }
    else if (argsdata[key] && !_.isString(argsdata[key])) {
      throw new Error(`The ${key} setting in stack-args.yaml must be a plain string or an environment map of strings.`);
    }
  }
  // have to configureAws before the call to transform as $imports might make AWS api calls.
  const cliOptionOverrides = _.pickBy(argv, (v: any, k: string) => !_.isEmpty(v) && _.includes(['region', 'profile', 'assumeRoleArn'], k));
  const argsfileSettings = {profile: argsdata.Profile, assumeRoleArn: argsdata.AssumeRoleARN, region: argsdata.Region};
  const mergedAWSSettings = _.merge(argsfileSettings, cliOptionOverrides);
  logger.debug(`loadStackArgs cliOptionOverrides`, cliOptionOverrides);
  logger.debug(`loadStackArgs argsfileSettings`, argsfileSettings);
  logger.debug(`loadStackArgs mergedAWSSettings`, mergedAWSSettings);
  await setupAWSCredentails(mergedAWSSettings); // cliOptionOverrides trump argsfile
  if (environment) {
    if (!_.get(argsdata, ['Tags', 'environment'])) {
      argsdata.Tags = _.merge({environment}, argsdata.Tags);
    }
  }
  const finalRegion = getCurrentAWSRegion();
  argsdata.$envValues = _.merge({}, argsdata.$envValues, {
    // TODO deprecate bare region/environment:
    region: finalRegion,
    environment,
    // new style with namespace to avoid clashes:
    iidy: {
      command: iidy_command,
      environment,
      region: finalRegion,
      profile: mergedAWSSettings.profile
    }
  });
  if (argsdata.CommandsBefore) {
    // TODO should we actually execute the commands if this is `iidy render`?
    if (_.includes(['create-stack', 'update-stack', 'create-changeset', 'create-or-update'], iidy_command)) {
      // The CommandsBefore strings are pre-processed for any handlebars
      // templates they contain. We call `transform` once here to get
      // the $envValues ($imports, $defs, etc.) and fully rendered
      // StackArgs so they're available to handlebars. It's called again
      // below to produce the final `stackArgsPass2` as these commands
      // might alter the values in $imports. For example, an import of
      // `filehash:lambda.zip` would change after the
      //
      const argsdataPass1: ExtendedCfnDoc = _.omit(_.cloneDeep(argsdata), ['CommandsBefore']);
      // NOTE any AWS api calls made in the imports will be made twice
      // because of the multiple passes. TODO use transformPostImports
      // instead and loadImports only once.
      const stackArgsPass1 = await transform(argsdataPass1, argsfile) as StackArgs;
      // TODO what about the rest of the $envValues from the imports and defs?
      const CommandsBeforeEnv = _.merge({
        iidy: {
          stackArgs: stackArgsPass1,
          stackName: argv.stackName || stackArgsPass1.StackName
        }
      }, argsdataPass1.$envValues);
      // We want `iidy render` to show the results of that pre-processing:
      argsdata.CommandsBefore = runCommandSet(argsdata.CommandsBefore, pathmod.dirname(argsfile), CommandsBeforeEnv);
    }
    else {
      // Not on an iidy command that require CommandsBefore to be processed
      // TODO ... do something more sensible here, such as escaping the commands
      delete argsdata.CommandsBefore;
    }
  }
  const stackArgsPass2 = await transform(argsdata, argsfile) as StackArgs;
  const stackArgsPass3 = recursivelyMapValues(stackArgsPass2, (value: any) => {
    if (typeof value === 'string') {
      // $0string is an encoding added in preprocess/index.ts:visitString
      return value.replace(/\$0string (0\d+)/g, '$1');
    }
    else {
      return value;
    }
  });
  logger.debug('argsdata -> stackArgs', argsdata, '\n', stackArgsPass3);
  return stackArgsPass3;
}


export async function loadStackArgs(
  argv: GenericCLIArguments,
  filterKeys: string[] = [],
  setupAWSCredentails = configureAWS)
: Promise<StackArgs> {
  // TODO json schema validation
  const args = await _loadStackArgs(argv.argsfile, argv, filterKeys, setupAWSCredentails);
  if (argv.clientRequestToken) {
    args.ClientRequestToken = argv.clientRequestToken;
  }
  return addDefaultNotificationArn(args);
}
