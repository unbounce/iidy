import {expect} from 'chai';
import * as aws from 'aws-sdk'
import { applyGlobalConfiguration } from '../cfn/loadStackArgs';

const ssmConfigTrue = [
  {
    Name: "/iidy/disable-template-approval",
    Type: "String",
    Value: "true",
    Version: 1,
    LastModifiedDate: "2018-08-22T13:49:55.717Z",
    ARN: "arn:aws:ssm:re-gion-0:1234567890:parameter/iidy/disable-template-approval"
  }
];

const ssmConfigFalse = [
  {
    Name: "/iidy/disable-template-approval",
    Type: "String",
    Value: "false",
    Version: 1,
    LastModifiedDate: "2018-08-22T13:49:55.717Z",
    ARN: "arn:aws:ssm:re-gion-0:1234567890:parameter/iidy/disable-template-approval"
  }
];

class MockSSM {
  constructor(private parameters: typeof ssmConfigTrue) {}
  getParametersByPath(params: { Path: string }): { promise: () => Promise<{ Parameters?: typeof ssmConfigTrue }> } {
    const Parameters = params.Path.match(/iidy/) ? this.parameters : undefined;
    return {
      promise: () => Promise.resolve({ Parameters })
    };
  }
}

describe('applyGlobalConfiguration', () => {
  it('noop if ApprovedTemplateLocation if set', async () => {
    const stackArgs = { StackName: 'name', Template: 'cfn-template.yaml' };
    await applyGlobalConfiguration(stackArgs, new MockSSM(ssmConfigTrue) as unknown as aws.SSM);
    expect(stackArgs).to.eqls({ StackName: 'name', Template: 'cfn-template.yaml' });
  });

  it('removes ApprovedTemplateLocation if set', async () => {
    const stackArgs = { StackName: 'name', Template: 'cfn-template.yaml', ApprovedTemplateLocation: 'foo' };
    await applyGlobalConfiguration(stackArgs, new MockSSM(ssmConfigTrue) as unknown as aws.SSM);
    expect(stackArgs).to.eqls({ StackName: 'name', Template: 'cfn-template.yaml' });
  });

  it('does not remove ApprovedTemplateLocation if not set', async () => {
    const stackArgs = { StackName: 'name', Template: 'cfn-template.yaml', ApprovedTemplateLocation: 'foo' };
    await applyGlobalConfiguration(stackArgs, new MockSSM([]) as unknown as aws.SSM);
    expect(stackArgs).to.eqls({ StackName: 'name', Template: 'cfn-template.yaml', ApprovedTemplateLocation: 'foo' });
  });

  it('does not remove ApprovedTemplateLocation if set to false', async () => {
    const stackArgs = { StackName: 'name', Template: 'cfn-template.yaml', ApprovedTemplateLocation: 'foo' };
    await applyGlobalConfiguration(stackArgs, new MockSSM(ssmConfigFalse) as unknown as aws.SSM);
    expect(stackArgs).to.eqls({ StackName: 'name', Template: 'cfn-template.yaml', ApprovedTemplateLocation: 'foo' });
  });
});
