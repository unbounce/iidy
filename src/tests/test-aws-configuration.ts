require('./support'); // for side-effect
import * as process from 'process';
import * as fs from 'fs';
import * as path from 'path';

import {expect} from 'chai';
import * as _ from 'lodash';
import * as aws from 'aws-sdk'

import {AWSRegions} from '../aws-regions';
import configureAWS from '../configureAWS';
import {AWSConfig} from '../configureAWS';
import getCurrentAWSRegion from '../getCurrentAWSRegion';

const awsUserDir = process.env.HOME ? path.join(process.env.HOME as string, '.aws') : null;

if (awsUserDir && fs.existsSync(awsUserDir)) {
  const SharedIni: any = require('aws-sdk/lib/shared_ini');
  if (!fs.existsSync(path.join(awsUserDir, 'credentials'))) {
    throw new Error('no credentials found in ~/.aws');
  }
  const awsConfigIni = new SharedIni({
    filename: path.join(awsUserDir, 'credentials')
  });
  const availableProfileNames = awsConfigIni.getProfiles();

  describe.only("AWS configuration", () => {

    describe("configureAWS", () => {
      const awsRegionEnvVars = ['AWS_REGION', 'AWS_DEFAULT_REGION'];
      const originalDefaultRegion = aws.config.region;
      const originalEnvVarSettings = _.fromPairs(_.map(awsRegionEnvVars, v => [v, process.env[v]]));
      const unsetAWSRegionEnvVars = () => {
        awsRegionEnvVars.forEach(v => {
          delete process.env[v];
        });
        aws.config.region = undefined;
      };
      const restoreOriginalEnvVarSettings = () => _.merge(process.env, originalEnvVarSettings);

      beforeEach(unsetAWSRegionEnvVars);
      after(restoreOriginalEnvVarSettings);

      it("does not barf with no arguments", async () => {
        // assumes a default region is set in ~/.aws
        aws.config.region = originalDefaultRegion;
        await configureAWS({});
        expect(getCurrentAWSRegion()).to.be.a('string');
      });

      it("respects env AWS_REGION and AWS_DEFAULT_REGION", async () => {
        for (const envVar of awsRegionEnvVars) {
          for (const region of AWSRegions) {
            unsetAWSRegionEnvVars();
            process.env[envVar] = region;
            await configureAWS({});
            expect(getCurrentAWSRegion()).to.equal(region);
          }
        }
        restoreOriginalEnvVarSettings();
      });

      it("updates aws.config.region after each call", async () => {
        for (const region of AWSRegions) {
          await configureAWS({region});
          expect(getCurrentAWSRegion()).to.equal(region);
        }
      });

      async function assertRoleAssumed(roleToAssume: string) {
        const roleAssumed = _.get(aws.config.credentials, 'roleArn');
        if (roleAssumed) {
          expect(roleAssumed).to.equal(roleToAssume);
        }
        expect(aws.config.credentials!.sessionToken).to.be.a('string');

        // const sts = new aws.STS();
        // const ident = await sts.getCallerIdentity().promise();
        // const roleSubString = roleToAssume.replace(/.*:(role\/[^\/]*)/, '$1');
        // expect(ident.Arn!.indexOf('assumed-' + roleSubString)).to.be.greaterThan(-1);

        // // TODO this currently fails as the aws sdk doesn't handle
        // // the `region` setting from profiles in ~/.aws/credentials
        //expect(getCurrentAWSRegion()).to.equal(profileDetails.region);
        // // console.log(profileDetails, aws.config.credentials, aws.config.region);

      }

      it("handles the profile argument", async () => {
        for (const profile of _.intersection(availableProfileNames, ['sandbox', 'staging'])) {
          const roleToAssume = awsConfigIni.getProfile(profile).role_arn;
          await configureAWS({profile});
          await assertRoleAssumed(roleToAssume);
        }
      });

      it("handles the assumeRoleArn argument", async () => {
        for (const profile of _.intersection(availableProfileNames, ['sandbox', 'staging'])) {
          const roleToAssume = awsConfigIni.getProfile(profile).role_arn;
          await configureAWS({assumeRoleArn: roleToAssume});
          await assertRoleAssumed(roleToAssume);
        }
      });

    });
  });
}
