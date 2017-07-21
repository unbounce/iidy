import * as process from 'process';
import * as _ from 'lodash';
import * as winston from 'winston';

export const logger = new winston.Logger({
  transports: [
    new winston.transports.Console({
      colorize: true,
      level: _.get(process.env, 'LOG_LEVEL', 'info'),
      prettyPrint: true
    })
  ]
});
