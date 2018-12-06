import {description, Handler, wrapCommandHandler, Argv} from '../cli-util';

export interface ApprovalCommands {
  request: Handler;
  review: Handler;
}

const lazyLoad = (fnname: keyof ApprovalCommands): Handler =>
  (args) => require('../approval')[fnname](args);

const lazy: ApprovalCommands = {
  request: lazyLoad('request'),
  review: lazyLoad('review')
}

export function buildApprovalCommands(args: Argv, commands = lazy): Argv {
  return args
    .strict()
    .demandCommand(1, 0)
    .command(
    'request <argsfile>',
    description('request template approval'),
    (args) => args
      .demandCommand(0, 0)
      .usage('Usage: iidy template-approval request stack-args.yaml')
      .strict(),
    wrapCommandHandler(commands.request))

    .command(
    'review <url>',
    description('review pending template approval request'),
    (args) => args
      .demandCommand(0, 0)
      .option('context', {
        type: 'number', default: 100,
        description: description('how many lines of diff context to show')
      })
      .usage('Usage: iidy template-approval review s3://bucket/path.pending')
      .strict(),
    wrapCommandHandler(commands.review)
    );
}
