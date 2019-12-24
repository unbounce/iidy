import {search} from 'jmespath';
import {GenericCLIArguments} from "./cli/types";
import {SUCCESS} from './statusCodes';
import * as output from './output';
import * as yaml from './yaml';
import configureAWS from "./configureAWS";
import {readFromImportLocation} from "./preprocess";


export async function getImportMain(argv: GenericCLIArguments): Promise<number> {
  await configureAWS(argv);
  const loc = argv.import;
  const baseLocation = '.';
  const importData = await readFromImportLocation(loc, baseLocation);

  let outputDoc = importData.doc;
  if (argv.query) {
      outputDoc = search(outputDoc, argv.query);
  }

  if (argv.format === 'yaml') {
    output.writeLine(yaml.dump(outputDoc))
  } else {
    output.writeLine(JSON.stringify(outputDoc, null, ' '));
  }
  return SUCCESS;
}
