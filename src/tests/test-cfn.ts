require('./support'); // for side-effect
import {expect} from 'chai';
import {loadStackArgs} from '../cfn';
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
});
