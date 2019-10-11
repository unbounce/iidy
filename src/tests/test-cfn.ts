import {expect} from 'chai';
import {loadStackArgs} from "../cfn/loadStackArgs";
import {readTemplateObj} from "../cfn/convertStackToIidy";
import * as yaml from "../yaml";
import * as aws from 'aws-sdk'

describe('cfn', () => {
  describe('loadStackArgs', () => {
    it('handles non-octal strings properly', async function() {
      const argv = {
        argsfile: 'src/tests/fixtures/stack-args-non-octal.yaml',
        environment: 'test',
        _: [''],
        '$0': ''
      };
      const args = await loadStackArgs(argv, [], async () => {
        // Mock out with fake credentials. This is required for things like
        // addDefaultNotificationArn to fail silently
        aws.config.credentials = new aws.EnvironmentCredentials('TEST');
      });
      expect(args.ServiceRoleARN).to.equal('arn:aws:iam::001234567890:role/name');
    });
  });

  describe('readTemplateObj', () => {
    it('handles AWSTemplateFormatVersion strings properly', async function() {
      const templateBody = 'AWSTemplateFormatVersion: 2010-09-09';
      const templateObj = readTemplateObj(templateBody, true);
      expect(yaml.dump(templateObj)).to.equal(
          "AWSTemplateFormatVersion: '2010-09-09'\n"
      );
    });

    it('handles Version strings properly', async function() {
      const templateBody = 'Version: 2010-09-09\n';
      const templateObj = readTemplateObj(templateBody, false);
      expect(yaml.dump(templateObj)).to.equal(
          "Version: '2010-09-09'\n"
      );
    });
  });

});
