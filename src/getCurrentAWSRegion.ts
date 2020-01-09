import * as aws from 'aws-sdk'

import {AWSRegion} from './aws-regions';

function getCurrentAWSRegion(): AWSRegion {
  // MUST be called after configureAWS()
  // this cast is only safe after that
  return (aws.config.region ||
                  process.env.AWS_REGION ||
                  process.env.AWS_DEFAULT_REGION) as AWSRegion; // tslint:disable-line
}

export default getCurrentAWSRegion;
