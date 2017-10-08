import {logger} from './logger';
import * as Promise from 'bluebird';


// TODO replace this hack with a proper module declaration
// tslint:disable
let ntpClient: any;
ntpClient = require('ntp-client');
ntpClient.ntpReplyTimeout = 2000;
type _getNetworkTime = (server: string, port: number, callback: (err: any, ts: Date) => void) => void;
let _getNetworkTime: _getNetworkTime;
_getNetworkTime = ntpClient.getNetworkTime;
const getNetworkTime = Promise.promisify(_getNetworkTime);
// tslint:enable

const getReliableTime = (): Promise<Date> =>
  getNetworkTime("pool.ntp.org", 123)
    .catch((e) => {
      logger.debug('error in getNetworkTime. Retrying', e = e)
      return getNetworkTime("pool.ntp.org", 123)
    }).catch((e) => {
      logger.debug('error in getNetworkTime. Falling back to new Date()', e = e)
      return new Date();
    });

export default getReliableTime;
