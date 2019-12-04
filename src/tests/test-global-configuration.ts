import {expect} from 'chai';
import * as aws from 'aws-sdk'
import { applyGlobalConfiguration } from '../cfn/loadStackArgs';

const mockSSMConfig = [
  {
    Name: "/iidy/disable-template-approval",
    Type: "String",
    Value: "true",
    Version: 1,
    LastModifiedDate: "2018-08-22T13:49:55.717Z",
    ARN: "arn:aws:ssm:re-gion-0:1234567890:parameter/iidy/disable-template-approval"
  }
];

class MockSSM {
  constructor(private parameters: typeof mockSSMConfig) {}
  getParametersByPath(params: { Path: string }): { promise: () => Promise<{ Parameters?: typeof mockSSMConfig }> } {
    const Parameters = params.Path.match(/iidy/) ? mockSSMConfig : undefined;
    return {
      promise: () => Promise.resolve({ Parameters })
    };
  }
}

describe('applyGlobalConfiguration', () => {
  it('noop if ApprovedTemplateLocation if set', async () => {
    const stackArgs = { StackName: 'name', Template: 'cfn-template.yaml' };
    const result = await applyGlobalConfiguration(stackArgs, new MockSSM(mockSSMConfig) as unknown as aws.SSM);
    expect(result).to.equal(stackArgs);
  });

  it('removes ApprovedTemplateLocation if set', async () => {
    const result = await applyGlobalConfiguration(
      { StackName: 'name', Template: 'cfn-template.yaml', ApprovedTemplateLocation: 'foo' },
      new MockSSM(mockSSMConfig) as unknown as aws.SSM
    );
    expect(result).to.eqls({ StackName: 'name', Template: 'cfn-template.yaml' });
  });

  it('does not remove ApprovedTemplateLocation if not set', async () => {
    const stackArgs = { StackName: 'name', Template: 'cfn-template.yaml', ApprovedTemplateLocation: 'foo' };
    const result = await applyGlobalConfiguration(
      stackArgs,
      new MockSSM([]) as unknown as aws.SSM
    );
    expect(result).to.equal(stackArgs);
  });
});
