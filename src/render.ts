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
    return !! (doc && doc.Template && (doc.Parameters || doc.Tags || doc.StackName));
  }
}

export type RenderArguments = GenericCLIArguments & {
  template: string;
  outfile: string;
  overwrite: boolean;
  query?: string;
  format?: string;
};

export type Writer = (output: string, outputPath: string, overwrite: boolean) => void;

export async function renderMain(argv0: GenericCLIArguments, writer: Writer = writeOutput): Promise<number> {
  const argv = argv0 as RenderArguments // ts, trust me
  await configureAWS(argv);

  // Read from STDIN (0) if the template is `-`
  // For some reason, yargs converts the `-` to `true`
  const isStdin = typeof argv.template === 'boolean' && argv.template === true;
  const templatePath = pathmod.resolve(isStdin ? '/dev/stdin' : argv.template);
  const file = isStdin ? 0 : templatePath;
  let output: string[] = [];

  if (fs.existsSync(templatePath) && fs.statSync(templatePath).isDirectory()) {
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

  writer(output.join('\n'), argv.outfile, argv.overwrite);
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
      outputDoc = await _loadStackArgs(rootDocLocation, argv);
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

// a stub'able wrapper around stream.write for easier testing
export const _writeToStream = (stream: NodeJS.WritableStream, output: string) => stream.write(output)

function writeOutput(output: string, outputPath: string, overwrite: boolean): void {
  let outputStream: NodeJS.WritableStream;

  if (_.includes(['/dev/stdout', 'stdout'], outputPath)) {
    outputStream = process.stdout;
  } else if (_.includes(['/dev/stderr', 'stderr'], outputPath)) {
    outputStream = process.stderr;
  } else {
    if (fs.existsSync(outputPath) && !overwrite) {
      throw new Error(`outfile '${outputPath}' exists. Use --overwrite to proceed.`);
    }
    outputStream = fs.createWriteStream(outputPath);
  }

  _writeToStream(outputStream, output);
}
