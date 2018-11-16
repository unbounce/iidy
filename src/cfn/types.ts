import * as aws from 'aws-sdk'

import {AWSRegion} from '../aws-regions';

export type CfnOperation = 'CREATE_STACK' | 'UPDATE_STACK' | 'CREATE_CHANGESET' | 'EXECUTE_CHANGESET' | 'ESTIMATE_COST';

export type StackArgs = {
  StackName: string;
  Template: string;
  ApprovedTemplateLocation?: string;
  Region?: AWSRegion;
  Profile?: string;
  Capabilities?: aws.CloudFormation.Capabilities;
  Tags?: {
    [key: string]: string;
  };
  Parameters?: {
    [key: string]: string;
  };
  NotificationARNs?: aws.CloudFormation.NotificationARNs;
  AssumeRoleARN?: string;
  ServiceRoleARN?: string;
  RoleARN?: string; // DEPRECATED in favour of ServiceRoleArn
  TimeoutInMinutes?: number;
  OnFailure?: 'ROLLBACK' | 'DELETE' | 'DO_NOTHING';
  DisableRollback?: boolean;
  EnableTerminationProtection?: boolean;
  StackPolicy?: string | object;
  ResourceTypes?: string[];
  ClientRequestToken?: string; //aws.CloudFormation.ClientToken,
  // for updates
  UsePreviousTemplate?: boolean;
  CommandsBefore?: string[];
};
