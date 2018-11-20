import * as fs from 'fs';
import {GenericCLIArguments} from '../cli-util';
import configureAWS from '../configureAWS';
import {_loadStackArgs} from './loadStackArgs';

export async function getStackNameFromArgsAndConfigureAWS(argv: GenericCLIArguments): Promise<string> {
  if (/.*\.(yaml|yml)$/.test(argv.stackname) && fs.existsSync(argv.stackname)) {
    const stackArgs = await _loadStackArgs(argv.stackname, argv);
    return stackArgs.StackName;
  }
  else {
    await configureAWS(argv);
    return argv.stackname;
  }
}
