import * as cli from 'cli-color';
import * as yargs from 'yargs';
import {GlobalArguments, Handler} from './cli-types';
import debug from './debug';
import {logger, setLogLevel} from './logger';
export {Handler, GlobalArguments, GenericCLIArguments, Argv, Options, ExitCode} from './cli-types';

export const description = cli.xterm(250);

export const fakeCommandSeparator = `\b\b\b\b\b     ${cli.black('...')}`;
// ^ the \b's are ansi backspace control chars to delete 'iidy' from
// help output on these fake commands. This allows us to visually
// separate the iidy help output into sets of commands.

export const wrapCommandHandler = (handler: Handler) =>
  function(args0: yargs.Arguments) {
    const args: GlobalArguments & yargs.Arguments = args0 as any; // coerce type
    if (!args.environment) {
      args.environment = 'development';
    }
    if (args.debug) {
      process.env.DEBUG = 'true';
      setLogLevel('debug');
    }
    handler(args)
      .then(process.exit)
      .catch(error => {
        if (debug() || args.logFullError || process.env.LOG_IIDY_ERROR) {
          logger.error(error);
        } else if (error.message) {
          logger.error(error.message);
        } else {
          logger.error(error);
        }
        process.exit(1);
      });
  };

export const stackNameOpt: yargs.Options = {
  type: 'string', default: null,
  alias: 's',
  description: description('override the StackName from <argsfile>')
};
