import * as fs from 'fs';
import * as pathmod from 'path';

import * as _ from 'lodash';
import {Arguments} from 'yargs';
import {search} from 'jmespath';

import configureAWS from './configureAWS';
import * as yaml from './yaml';
import {transform} from './preprocess';
import {_loadStackArgs} from './cfn';
import {logger} from './logger';
import getCurrentAWSRegion from './getCurrentAWSRegion';
import {GlobalArguments} from './cli';

export function isStackArgsFile(location: string, doc: any): boolean {
  if (pathmod.basename(location).match(/stack-args/)) {
    return true;
  } else {
    return doc && doc.Template && (doc.Parameters || doc.Tags || doc.StackName);
  }
}

export type RenderArguments = GlobalArguments & {
  template: string;
  outfile: string;
  overwrite: boolean;
  query?: string;
  format?: string;
};

export async function renderMain(argv: RenderArguments): Promise<number> {
  await configureAWS(argv);
  const rootDocLocation = pathmod.resolve(argv.template);
  const content = fs.readFileSync(rootDocLocation);
  const input = yaml.loadString(content, rootDocLocation);

  let outputDoc: any;
  if (isStackArgsFile(rootDocLocation, input)) {
    // TODO remove the cast to any below after tightening the args on _loadStackArgs
    outputDoc = await _loadStackArgs(rootDocLocation, argv as any);
  } else {
    // injection of $region / $environment is handled by _loadStackArgs in the if branch above
    input.$envValues = _.merge({}, input.$envValues, {iidy: {environment: argv.environment, region: getCurrentAWSRegion()}});
    outputDoc = await transform(input, rootDocLocation);
  }
  if (argv.query) {
    outputDoc = search(outputDoc, argv.query);
  }
  const outputString = argv.format === 'yaml' ? yaml.dump(outputDoc) : JSON.stringify(outputDoc, null, ' ');
  if (_.includes(['/dev/stdout', 'stdout'], argv.outfile)) {
    console.log(outputString);
  } else if (_.includes(['/dev/stderr', 'stderr'], argv.outfile)) {
    process.stderr.write(outputString);
    process.stderr.write('\n');
  } else {
    if (fs.existsSync(argv.outfile) && !argv.overwrite) {
      logger.error(`outfile '${argv.outfile}' exists. Use --overwrite to proceed.`);
      return 1;
    }
    fs.writeFileSync(argv.outfile, outputString);
  }
  return 0;
};
