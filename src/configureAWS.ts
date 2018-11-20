import * as process from 'process';

import * as inquirer from 'inquirer';
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

import * as _ from 'lodash';
import * as aws from 'aws-sdk';

import {logger} from './logger';
import {AWSRegion} from './aws-regions';

function getCredentialsProviderChain(profile?: string) {
  const hasDotAWS = (awsUserDir && fs.existsSync(awsUserDir));
  if (profile && ! _.includes(['no-profile', 'noprofile'], profile)) {
    if (profile.startsWith('arn:')) {
      throw new Error('profile was set to a role ARN. Use AssumeRoleArn instead');
    }
    if (!hasDotAWS) {
      throw new Error('AWS profile provided but ~/.aws/{config,credentials} not found.');
    }
    const tokenCodeFn = (serial: string, cb: (err?: Error, token?: string) => void) => {
      const prompt = inquirer.createPromptModule({output: process.stderr});
      prompt<{token: string}>(
        {
          name: 'token',
          type: 'input',
          default: '',
          message: `MFA token for ${serial}:`
        }).then((r) => {
          cb(undefined, r.token);
        }).catch((e) => {
          cb(e);
        });
    };
    return new aws.CredentialProviderChain([() => new aws.SharedIniFileCredentials({profile, tokenCodeFn, useCache: true})]);
  } else {
    return new aws.CredentialProviderChain();
  }
}

async function resolveCredentials(profile?: string, assumeRoleArn?: string) {
  if (assumeRoleArn && ! _.includes(['no-role', 'norole'], assumeRoleArn)) {
    const masterCreds = await getCredentialsProviderChain(profile).resolvePromise();
    const tempCreds = new aws.TemporaryCredentials({RoleArn: assumeRoleArn, RoleSessionName: 'iidy'}, masterCreds);
    await tempCreds.getPromise();
    aws.config.credentials = tempCreds;
  } else {
    // note, profile might be undefined here and that's fine.
    aws.config.credentials = await getCredentialsProviderChain(profile)
      .resolvePromise()
      //.timeout(10500) // consider doing this as ETIMEDOUT takes a long time
      .catch((e) => {
        if (e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED') {
          throw new Error("iidy can't find any local AWS credentials or connect to the AWS metadata service (169.254.169.254)");
        } else {
          throw e;
        }
      });
    // TODO optionally cache the credentials here
  }
}

// TODO change to this interface
export interface AWSConfig {
  profile?: string;
  region?: AWSRegion;
  assumeRoleArn?: string;
}

async function configureAWS(config: AWSConfig) {
  const resolvedProfile: string | undefined = (
    config.profile || process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE);
  await resolveCredentials(resolvedProfile, config.assumeRoleArn);

  const resolvedRegion = (
    config.region
    || process.env.AWS_REGION
    || process.env.AWS_DEFAULT_REGION);
  if (!_.isEmpty(resolvedRegion)) {
    logger.debug(`Setting AWS region: ${resolvedRegion}. aws.config.region was previously ${aws.config.region}`);
    aws.config.update({region: resolvedRegion});
  }
  aws.config.update({maxRetries: 10}); // default is undefined -> defaultRetryCount=3
  // the sdk will handle exponential backoff internally.
  // 1=100ms, 2=200ms, 3=400ms, 4=800ms, 5=1600ms,
  // 6=3200ms, 7=6400ms, 8=12800ms, 9=25600ms, 10=51200ms, 11=102400ms, 12=204800ms
}

export default configureAWS;
