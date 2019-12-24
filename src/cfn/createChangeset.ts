import {writeLine} from '../output';
import {GenericCLIArguments} from '../cli/utils';
import {SUCCESS} from '../statusCodes';
import {DEFAULT_EVENT_POLL_INTERVAL} from './defaults';
import {loadStackArgs} from './loadStackArgs';
import {summarizeStackContents} from './summarizeStackContents';
import {watchStack} from './watchStack';
import {CreateChangeSet} from './index';

export async function createChangesetMain(argv: GenericCLIArguments): Promise<number> {
  const changesetRunner = new CreateChangeSet(argv, await loadStackArgs(argv));
  const changesetExitCode = await changesetRunner.run();
  if (argv.watch && changesetExitCode === 0) {
    writeLine();
    await watchStack(changesetRunner.stackName, new Date(), DEFAULT_EVENT_POLL_INTERVAL, argv.watchInactivityTimeout);
    writeLine();
    await summarizeStackContents(changesetRunner.stackName);
    return SUCCESS;
  }
  else {
    return changesetExitCode;
  }
}
