import * as process from 'process';
import * as _ from 'lodash';
import * as winston from 'winston';
import debug from './debug';

let LOG_LEVEL: string;
if (debug()) {
  LOG_LEVEL = 'debug';
} else {
  LOG_LEVEL = _.get(process.env, 'LOG_LEVEL', 'info').toLowerCase();
}

const consoleLogger = new winston.transports.Console({
      colorize: true,
      level: LOG_LEVEL,
      prettyPrint: true
});

export function setLogLevel(level: string) {
  consoleLogger.level = level;
}

export const logger = new winston.Logger({
  transports: [consoleLogger]
});
