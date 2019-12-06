import {readFileSync} from 'fs';
import {expect} from 'chai';
import {loadStackArgs} from "../cfn/loadStackArgs";
import {readTemplateObj} from "../cfn/convertStackToIidy";
import * as yaml from "../yaml";
import * as aws from 'aws-sdk'
import {stackArgsToCreateStackInput, stackArgsToCreateChangeSetInput, stackArgsToUpdateStackInput} from '../cfn/stackArgsToX';
import {StackArgs} from '../cfn/types';
import configureAWS from '../configureAWS';
import maybeSignS3HttpUrl from '../cfn/maybeSignS3HttpUrl';
import objectToCFNParams from '../cfn/objectToCFNParams';

const MINIMAL_TEMPLATE_FIXTURE_PATH = 'src/tests/fixtures/cfn-template.minimal.yaml';
const MINIMAL_TEMPLATE_FIXTURE_BODY = readFileSync(MINIMAL_TEMPLATE_FIXTURE_PATH).toString();

const MINIMAL_STACK_ARGS_WITH_LOCAL_TEMPLATE = {
  StackName: 'test',
  Template: MINIMAL_TEMPLATE_FIXTURE_PATH,
};

const MINIMAL_STACK_ARGS_WITH_S3_TEMPLATE = {
  StackName: 'test',
  Template: 'https://s3.us-east-1.amazonaws.com/somebucket/somekey2.yaml',
};

describe('cfn', function() {
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

  describe('stackArgsTo{CreateStackInput, UpdateStackInput, CreateChangeSetInput}', function() {
    const assertValidOutputCommonOnMinimalStack = (
      stackArgs: StackArgs,
      cfnArgs: aws.CloudFormation.CreateStackInput
        | aws.CloudFormation.UpdateStackInput
        | aws.CloudFormation.CreateChangeSetInput) => {
      if (stackArgs.Template.includes('s3')) {
        expect(cfnArgs.TemplateBody).to.equal(undefined);
        expect(cfnArgs.TemplateURL).to.equal(maybeSignS3HttpUrl(stackArgs.Template));
      } else {
        expect(cfnArgs.TemplateURL).to.equal(undefined);
        expect(cfnArgs.TemplateBody).to.equal(MINIMAL_TEMPLATE_FIXTURE_BODY);
      }

      expect(cfnArgs.StackName).to.equal(stackArgs.StackName);
      expect(cfnArgs.Parameters).to.deep.equal([]);
      expect(cfnArgs.Tags).to.deep.equal([]);
    }

    it('accepts the minimal required input and template on disk', async function() {
      const stackArgs = MINIMAL_STACK_ARGS_WITH_LOCAL_TEMPLATE;
      const cfnArgsForCreate = await stackArgsToCreateStackInput(stackArgs, './stack-args.yaml', 'development');
      assertValidOutputCommonOnMinimalStack(stackArgs, cfnArgsForCreate);

      const cfnArgsForUpdate = await stackArgsToUpdateStackInput(stackArgs, './stack-args.yaml', 'development');
      assertValidOutputCommonOnMinimalStack(stackArgs, cfnArgsForUpdate);

      const cfnArgsForCreateChangeset = await stackArgsToCreateChangeSetInput('changes', stackArgs, './stack-args.yaml', 'development');
      assertValidOutputCommonOnMinimalStack(stackArgs, cfnArgsForCreateChangeset);
    });

    it('accepts the minimal required input and template on s3', async function() {
      if (process.env.SKIP_IIDY_AWS_TEST) {
        this.skip()
      }
      await configureAWS({});
      const stackArgs = MINIMAL_STACK_ARGS_WITH_S3_TEMPLATE;
      const cfnArgsForCreate = await stackArgsToCreateStackInput(stackArgs, './stack-args.yaml', 'development');
      assertValidOutputCommonOnMinimalStack(stackArgs, cfnArgsForCreate);

      const cfnArgsForUpdate = await stackArgsToUpdateStackInput(stackArgs, './stack-args.yaml', 'development');
      assertValidOutputCommonOnMinimalStack(stackArgs, cfnArgsForUpdate);

      const cfnArgsForCreateChangeset = await stackArgsToCreateChangeSetInput('changes', stackArgs, './stack-args.yaml', 'development');
      assertValidOutputCommonOnMinimalStack(stackArgs, cfnArgsForCreateChangeset);
    });

    it('correctly handles UsePreviousParameterValues', async function() {
      const UsePreviousParameterValues = ['foo', 'bar'];
      const Parameters = {
        foo: 'a',
        bar: 'b'
      };

      const transformedParams = Object.keys(Parameters).map(ParameterKey => ({ParameterKey, UsePreviousValue: true}));
      const stackArgs = {
        ...MINIMAL_STACK_ARGS_WITH_LOCAL_TEMPLATE,
        Parameters,
        UsePreviousParameterValues
      };
      const cfnArgsForCreate = await stackArgsToCreateStackInput(stackArgs, './stack-args.yaml', 'development');
      expect(cfnArgsForCreate.Parameters).to.deep.equal(objectToCFNParams(stackArgs.Parameters));

      const cfnArgsForUpdate = await stackArgsToUpdateStackInput(stackArgs, './stack-args.yaml', 'development');
      expect(cfnArgsForUpdate.Parameters).to.deep.equal(transformedParams);

      const cfnArgsForCreateChangeset = await stackArgsToCreateChangeSetInput('changes', stackArgs, './stack-args.yaml', 'development');
      expect(cfnArgsForCreateChangeset.Parameters).to.deep.equal(transformedParams);

    });

  });

});
