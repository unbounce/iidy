import * as fs from 'fs';

export async function initStackArgs() : Promise<number> {
  // await configureAWS(argv.profile, argv.region);
  // Here we import the File System module of node
  const stackArgs = `# REQUIRED SETTINGS:
StackName: <string>
Template: <local file path or s3 path>
# optionally you can use the yaml pre-processor by prepending 'render:' to the filename
# Template: render:<local file path or s3 path>

# OPTIONAL SETTINGS:
# Region: <aws region name>
# Profile: <aws profile name>

# aws tags to apply to the stack
Tags:
#   owner: <your name>
#   environment: development
#   project: <your project>
#   lifetime: short

# stack parameters
Parameters:
#   key1: value
#   key2: value

# optional list. *Preferably empty*
Capabilities:
#   - CAPABILITY_IAM
#   - CAPABILITY_NAMED_IAM

NotificationARNs:
#   - <sns arn>

# CloudFormation ServiceRole
# RoleARN: arn:aws:iam::<acount>:role/<rolename>

# TimeoutInMinutes: <number>

# OnFailure defaults to ROLLBACK
# OnFailure: 'ROLLBACK' | 'DELETE' | 'DO_NOTHING'

# StackPolicy: <local file path or s3 path>

# see http://docs.aws.amazon.com/cli/latest/reference/cloudformation/create-stack.html#options
# ResourceTypes: <list of aws resource types allowed in the template>

# shell commands to run prior the cfn stack operation
# CommandsBefore:
#   - make build # for example`


  fs.writeFileSync('stack-args.yaml', stackArgs);
  console.log("stack-args.yaml has been created!");
  return 0;
}