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
  // 1=100ms, 2=200ms, 3=400ms, 4=800ms, 5=1600ms,
  // 6=3200ms, 7=6400ms, 8=12800ms, 9=25600ms, 10=51200ms, 11=102400ms, 12=204800ms
}

export default configureAWS;
