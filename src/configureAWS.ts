import * as process from 'process';

import * as fs from 'fs';
import * as path from 'path';

const awsUserDir = process.env.HOME ? path.join(process.env.HOME as string, '.aws') : null;
if (awsUserDir && fs.existsSync(awsUserDir)) {
  // We also set this env-var in the main cli entry-point
  process.env.AWS_SDK_LOAD_CONFIG = '1'; // see https://github.com/aws/aws-sdk-js/pull/1391
  // Note:
  // if this is set and ~/.aws doesn't exist we run into issue #17 as soon as the sdk is loaded:
  //  Error: ENOENT: no such file or directory, open '.../.aws/credentials
}

const USE_AWS_CLI_STS_CACHE = process.env.iidy_use_sts_cache !== undefined;

import * as _ from 'lodash';
import * as aws from 'aws-sdk';

import {logger} from './logger';
import {AWSRegion} from './aws-regions';

async function loadSharedIniFile(profile?: string) {
  // note, profile might be undefined here and that's fine.
  const credentials = new aws.SharedIniFileCredentials({profile});
  //await credentials.refreshPromise();
  aws.config.credentials = credentials;
}

async function configureAWS(profile?: string, region?: AWSRegion) {
  const resolvedProfile: string | undefined = (
    profile || process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE);

  if (process.env.AWS_ACCESS_KEY_ID && !resolvedProfile) {
    logger.debug(`Using AWS env vars. AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID}.`);
  } else if (awsUserDir && fs.existsSync(awsUserDir)) {
    logger.debug(`Using AWS ~/.aws/{config,credentials} file: profile: ${resolvedProfile}.`);
    const cliCacheDir = path.join(awsUserDir, 'cli', 'cache');
    if (USE_AWS_CLI_STS_CACHE && resolvedProfile && fs.existsSync(cliCacheDir)) {
      // look for a valid cache entry in ./aws/cli/cache/
      const fileRE = new RegExp(`^${resolvedProfile}--`);
      const profileCacheFiles = _.filter(fs.readdirSync(cliCacheDir), (filename) => fileRE.test(filename));
      if (profileCacheFiles.length === 1) {
        const cachedEntry = JSON.parse(fs.readFileSync(path.join(cliCacheDir, profileCacheFiles[0]), 'utf-8').toString());
        await loadSharedIniFile(undefined); // load master credentials first
        const sts = new aws.STS();
        const credentialsFrom: any = _.get(sts, 'credentialsFrom'); // work around missing typedef
        const assumedCreds: aws.TemporaryCredentials = credentialsFrom(cachedEntry);
        const credentialsExpired = (new Date(cachedEntry.Credentials.Expiration) < new Date() || assumedCreds.needsRefresh());
        if (credentialsExpired) {
          await loadSharedIniFile(resolvedProfile);
        } else {
          aws.config.credentials = assumedCreds;
        }
      } else {
        await loadSharedIniFile(resolvedProfile);
      }
    } else {
      await loadSharedIniFile(resolvedProfile);
    }
  } else if (resolvedProfile) {
    throw new Error('AWS profile provided but ~/.aws/{config,credentials} not found.')
  } else {
    logger.debug('Using AWS ec2 instance profile.');
  }


  if (typeof region === 'string') {
    logger.debug(`Setting AWS region: ${region}.`);
    aws.config.update({region});
  }
  aws.config.update({maxRetries: 10}); // default is undefined -> defaultRetryCount=3
  // the sdk will handle exponential backoff internally.
  // 1=100ms, 2=200ms, 3=400ms, 4=800ms, 5=1600ms,
  // 6=3200ms, 7=6400ms, 8=12800ms, 9=25600ms, 10=51200ms, 11=102400ms, 12=204800ms
}

export default configureAWS;
