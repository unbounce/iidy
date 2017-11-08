import * as fs from 'fs';
import * as pathmod from 'path';

import * as _ from 'lodash';
import {Arguments} from 'yargs';

import configureAWS from './configureAWS';
import * as yaml from './yaml';
import {transform} from './index';
import {_loadStackArgs} from './cfn';
import {logger} from './logger';

import {search} from 'jmespath';

export function isStackArgsFile(location: string, doc: any): boolean {
  if (_.includes(['stack-args.yaml', 'stack-args.yml'], pathmod.basename(location))) {
    return true;
  } else {
    return doc.Template && (doc.Parameters || doc.Tags || doc.StackName);
  }
}

export async function renderMain(argv: Arguments): Promise<number> {
  await configureAWS(argv.profile, argv.region)
  const rootDocLocation = pathmod.resolve(argv.template);
  const content = fs.readFileSync(rootDocLocation);
  const input = yaml.loadString(content, rootDocLocation);

  let outputDoc: any;
  if (isStackArgsFile(rootDocLocation, input)) {
    outputDoc = await _loadStackArgs(rootDocLocation, argv.region, argv.profile, argv.environment);
  } else {
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
