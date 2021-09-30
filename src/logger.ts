import * as process from 'process';
import * as _ from 'lodash';
import * as winston from 'winston';

import * as util from 'util';

import debug from './debug';

const {combine, printf} = winston.format;

const useColor = process.stdout.isTTY;
const inspectArgs = {
  colors: useColor,
  depth: 5
};

const consoleFormat = printf(info => {
  const data: any = _.omit(info, [
    Symbol.for('message'), 'message',
    Symbol.for('level'), 'level',
    Symbol.for('timestamp'), 'timestamp',
    Symbol.for('splat')
  ]);
  const splat = info[Symbol.for('splat') as any];
  const splatDisplay = !_.isEmpty(splat)
    ? '\n  ' + splat.map((item: any) => util.inspect(item, inspectArgs)).join(' ')
    : '';
  const dataDisplay = !_.isEmpty(data)
    ? '\n  ' + util.inspect(data, inspectArgs)
    : '';
  //const timestamp = useColor ? cli.blackBright(info.timestamp) : info.timestamp;
  return `${info.level} ${info.message} ${splatDisplay} ${dataDisplay}`;
});

let LOG_LEVEL: string;
if (debug()) {
  LOG_LEVEL = 'debug';
} else {
  LOG_LEVEL = _.get(process.env, 'LOG_LEVEL', 'info')!.toLowerCase();
}

const consoleLogger = new winston.transports.Console({
  level: LOG_LEVEL,
  stderrLevels: ['error', 'debug'],
  format: combine((useColor ? winston.format.colorize() : winston.format.simple()),
    consoleFormat)
});

export function setLogLevel(level: string) {
  consoleLogger.level = level;
}

export const logger = winston.createLogger({
  transports: [consoleLogger]
});
