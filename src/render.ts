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
import {SUCCESS, FAILURE} from './statusCodes';

export function isStackArgsFile(location: string, doc: any): boolean {
  if (pathmod.basename(location).match(/stack-args/)) {
    return true;
  } else {
    return doc && doc.Template && (doc.Parameters || doc.Tags || doc.StackName);
  }
}

export type RenderArguments = GlobalArguments & Arguments & {
  template: string;
  outfile: string;
  overwrite: boolean;
  query?: string;
  format?: string;
};

export async function renderMain(argv: RenderArguments): Promise<number> {
  await configureAWS(argv);

  // Read from STDIN (0) if the template is `-`
  // For some reason, yargs converts the `-` to `true`
  const isStdin = typeof argv.template === 'boolean' && argv.template === true;
  const rootDocLocation = pathmod.resolve(isStdin ? '-' : argv.template);
  const file = isStdin ? 0 : rootDocLocation;

  const content = fs.readFileSync(file);
  const input = yaml.loadString(content, rootDocLocation);

  let outputDoc: any;
  if (isStackArgsFile(rootDocLocation, input)) {
    // TODO remove the cast to any below after tightening the args on _loadStackArgs
    outputDoc = await _loadStackArgs(rootDocLocation, argv as any);
  } else {
    // injection of iidy env is handled by _loadStackArgs in the if branch above
    input.$envValues = _.merge({}, input.$envValues, {
      iidy: {
        command: argv._.join(' '),
        environment: argv.environment,
        region: getCurrentAWSRegion()
        // NOTE: missing profile which is present in stackArgs rendering
      }
    });
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
      return FAILURE;
    }
    fs.writeFileSync(argv.outfile, outputString);
  }
  return SUCCESS;
};
