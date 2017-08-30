import * as fs from 'fs';
import * as path from 'path';
import * as aws from 'aws-sdk';

import { logger } from './logger';
import { AWSRegion } from './aws-regions';

async function configureAWS(profile?: string, region?: AWSRegion) {
  process.env.AWS_SDK_LOAD_CONFIG = 'true'; // see https://github.com/aws/aws-sdk-js/pull/1391
  
  if (process.env.AWS_ACCESS_KEY_ID && ! profile) {
    logger.debug(`Using AWS env vars. AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID}.`);
  } else if (process.env.HOME && fs.existsSync(path.join(process.env.HOME as string, '.aws'))) {
    logger.debug(`Using AWS ~/.aws/{config,credentials} file: profile: ${profile}.`);
    // note, profile might be undefined here and that's fine.
    const credentials = new aws.SharedIniFileCredentials({profile});
    await credentials.refreshPromise();
    aws.config.credentials = credentials;
  } else if (profile || process.env.AWS_PROFILE) {
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
  // 0m, 50ms, 100ms, 200ms, 400ms, 800ms, 1600ms, 3200ms, 6400ms, 12800ms
}

export default configureAWS;
