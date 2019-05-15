import * as process from 'process';
import * as fs from 'fs';
import * as path from 'path';

import {expect} from 'chai';
import * as _ from 'lodash';
import * as aws from 'aws-sdk'
import {iniLoader} from 'aws-sdk/lib/shared-ini';

import {AWSRegions} from '../aws-regions';
import configureAWS from '../configureAWS';
import getCurrentAWSRegion from '../getCurrentAWSRegion';

const awsUserDir = process.env.HOME ? path.join(process.env.HOME as string, '.aws') : null;

if (awsUserDir && fs.existsSync(awsUserDir)) {
  if (!fs.existsSync(path.join(awsUserDir, 'credentials'))) {
    throw new Error('no credentials found in ~/.aws');
  }
  const awsConfigIni = iniLoader.loadFrom({filename: path.join(awsUserDir, 'credentials')});
  const availableProfileNames = _.keys(awsConfigIni);

  describe("AWS configuration", () => {
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

      beforeEach(unsetAWSRegionEnvVars);
      afterEach(() => {
        _.merge(process.env, originalEnvVarSettings);
        aws.config.region = originalDefaultRegion;
      });

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
        expect(aws.config.credentials!.sessionToken)
          .to.be.a('string', 'aws.config.credentials.sessionToken is missing');

        // const sts = new aws.STS();
        // const ident = await sts.getCallerIdentity().promise();
        // const roleSubString = roleToAssume.replace(/.*:(role\/[^\/]*)/, '$1');
        // expect(ident.Arn!.indexOf('assumed-' + roleSubString)).to.be.greaterThan(-1);

        // // TODO this currently fails as the aws sdk doesn't handle
        // // the `region` setting from profiles in ~/.aws/credentials
        //expect(getCurrentAWSRegion()).to.equal(profileDetails.region);
        // // console.log(profileDetails, aws.config.credentials, aws.config.region);

      }

      const testProfiles = ['sandbox']; // add more here to test for state bugs
      it("handles the profile argument", async function() {
        this.timeout(15000);
        for (const profile of _.intersection(availableProfileNames, testProfiles)) {
          const roleToAssume = awsConfigIni[profile].role_arn;
          await configureAWS({profile});
          await assertRoleAssumed(roleToAssume);
        }
      });

      it.skip("handles the assumeRoleArn argument", async function() {
        // NOTE disabled this test as we don't yet have a way of handling mfa tokens with assumeRoleArn
        this.timeout(15000);
        for (const profile of _.intersection(availableProfileNames, testProfiles)) {
          const roleToAssume = awsConfigIni[profile].role_arn;
          await configureAWS({assumeRoleArn: roleToAssume});
          await assertRoleAssumed(roleToAssume);
        }
      });

    });
  });
}
