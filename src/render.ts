import * as fs from 'fs';
import {search} from 'jmespath';
import * as _ from 'lodash';
import * as pathmod from 'path';
import {_loadStackArgs} from "./cfn/loadStackArgs";
import {GenericCLIArguments} from './cli/utils';
import configureAWS from './configureAWS';
import getCurrentAWSRegion from './getCurrentAWSRegion';
import {ExtendedCfnDoc, transform} from './preprocess';
import {SUCCESS} from './statusCodes';
import * as yaml from './yaml';

export function isStackArgsFile(location: string, doc: any): boolean {
  if (pathmod.basename(location).match(/stack-args/)) {
    return true;
  } else {
    return doc && doc.Template && (doc.Parameters || doc.Tags || doc.StackName);
  }
}

export type RenderArguments = GenericCLIArguments & {
  template: string;
  outfile: string;
  overwrite: boolean;
  query?: string;
  format?: string;
};

export async function renderMain(argv0: GenericCLIArguments): Promise<number> {
  const argv = argv0 as RenderArguments // ts, trust me
  await configureAWS(argv);

  // Read from STDIN (0) if the template is `-`
  // For some reason, yargs converts the `-` to `true`
  const isStdin = typeof argv.template === 'boolean' && argv.template === true;
  const templatePath = pathmod.resolve(isStdin ? '-' : argv.template);
  const file = isStdin ? 0 : templatePath;
  let output: string[] = [];

  if (!isStdin && fs.statSync(templatePath).isDirectory()) {
    for (const filename of fs.readdirSync(templatePath)) {
      if (filename.match(/\.(yml|yaml)$/)) {
        const filepath = pathmod.resolve(templatePath, filename);
        const content = fs.readFileSync(filepath);
        const documents = yaml.loadStringAll(content, filepath);
        output = output.concat(await render(filepath, documents, argv, true));
      }
    }
  } else {
    const content = fs.readFileSync(file);
    const documents = yaml.loadStringAll(content, templatePath);
    output = await render(templatePath, documents, argv);
  }

  writeOutput(output.join('\n'), argv.outfile, argv.overwrite);
  return SUCCESS;
}

export async function render(
  rootDocLocation: string,
  documents: ExtendedCfnDoc[],
  argv: RenderArguments,
  multiDocument?: boolean
) {
  const yamlHeader = documents.length > 1 || multiDocument;
  const output = [];

  for (const input of documents) {
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

    if (argv.format === 'yaml') {
      if (yamlHeader) {
        output.push('---');
      }

      output.push(yaml.dump(outputDoc))
    } else {
      output.push(JSON.stringify(outputDoc, null, ' '));
    }

  };

  return output;
};

// a stub'able wrapper around fs.writeSync for easier testing
export const _writeSyncToFile = (fd: number, output: string) => {
  fs.writeSync(fd, output);
}

function writeOutput(output: string, outputPath: string, overwrite: boolean): void {
  let outputFD: number;
  // Note, we reopen stdout/stderr here using fs.openSync to ensure we don't encounter partial writes to pipes/ttys.
  // See issue #238.

  if (_.includes(['/dev/stdout', 'stdout'], outputPath)) {
    outputFD = fs.openSync('/dev/stdout', 'w');
  } else if (_.includes(['/dev/stderr', 'stderr'], outputPath)) {
    outputFD = fs.openSync('/dev/stderr', 'w');
  } else {
    if (fs.existsSync(outputPath) && !overwrite) {
      throw new Error(`outfile '${outputPath}' exists. Use --overwrite to proceed.`);
    }
    outputFD = fs.openSync(outputPath, 'w');
  }
  _writeSyncToFile(outputFD, output);
}
