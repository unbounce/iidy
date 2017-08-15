import * as aws from 'aws-sdk'

import { AWSRegion } from './aws-regions';

async function configureAWS(profile?: string, region?: AWSRegion) {
  process.env.AWS_SDK_LOAD_CONFIG = 'true'; // see https://github.com/aws/aws-sdk-js/pull/1391
  const credentials = new aws.SharedIniFileCredentials({profile});
  await credentials.refreshPromise()
  aws.config.credentials = credentials;
  if (typeof region === 'string') {
    aws.config.update({region});
  }
}

export default configureAWS;
