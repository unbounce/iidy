import * as aws from 'aws-sdk';
import * as cli from 'cli-color';
import {sprintf} from 'sprintf-js';
import {GenericCLIArguments} from '../cli-util';
import getCurrentAWSRegion from '../getCurrentAWSRegion';
import {SUCCESS} from '../statusCodes';
import {formatTimestamp, renderTimestamp} from './formatting';
import {getStackNameFromArgsAndConfigureAWS} from "./getStackNameFromArgsAndConfigureAWS";

export async function getStackInstancesMain(argv: GenericCLIArguments): Promise<number> {
  const StackName = await getStackNameFromArgsAndConfigureAWS(argv);
  const region = getCurrentAWSRegion();
  const ec2 = new aws.EC2();
  const instances = await ec2.describeInstances({
    Filters: [{
      Name: 'tag:aws:cloudformation:stack-name',
      Values: [StackName]
    }]
  })
    .promise();
  for (const reservation of instances.Reservations || []) {
    for (const instance of reservation.Instances || []) {
      if (argv.short) {
        console.log(instance.PublicDnsName ? instance.PublicDnsName : instance.PrivateIpAddress);
      }
      else {
        const state = instance.State ? instance.State.Name : 'unknown';
        const placement = instance.Placement ? instance.Placement.AvailabilityZone : '';
        console.log(sprintf('%-42s %-15s %s %-11s %s %s %s', instance.PublicDnsName, instance.PrivateIpAddress, instance.InstanceId, instance.InstanceType, state, placement, formatTimestamp(renderTimestamp(instance.LaunchTime as Date))));
      }
    }
  }
  console.log(cli.blackBright(`https://console.aws.amazon.com/ec2/v2/home?region=${region}#Instances:tag:aws:cloudformation:stack-name=${StackName};sort=desc:launchTime`));
  return SUCCESS;
}
