import * as aws from 'aws-sdk'

export default (ev: aws.CloudFormation.StackEvent): boolean =>
  ev.PhysicalResourceId != '' &&
  (ev.ResourceType === 'AWS::CloudFormation::Stack') &&
  ev.StackId != ev.PhysicalResourceId
