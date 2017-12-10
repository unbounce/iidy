import * as fs from 'fs';
import {Arguments} from 'yargs';

export async function initStackArgs(argv: Arguments): Promise<number> {

  const cfnTemplateArgs = `Dummy:
    Type: "AWS::CloudFormation::WaitConditionHandle"
    Properties: {}`;

  const stackArgs = `# REQUIRED SETTINGS:
StackName: <string>
Template: ./cfn-template.yaml
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
#   - make build # for example`;


  let stackArgsInitialized = fs.existsSync('./stack-args.yaml');
  let cfnTemplateInitialized = fs.existsSync('./cfn-template.yaml');

  let forceStackArgs = argv.force || argv.forceStackArgs;
  let forceCfnTemplate = argv.force || argv.forceCfnTemplate;

  if (stackArgsInitialized && !forceStackArgs) {
    console.log("stack-args.yaml already exists! See help [-h] for overwrite options");
  }
  else {
    fs.writeFileSync('stack-args.yaml', stackArgs);
    console.log("stack-args.yaml has been created!");
  }


  if (cfnTemplateInitialized && !forceCfnTemplate) {
    console.log("cfn-template.yaml already exists! See help [-h] for overwrite options");
  }
  else {
    fs.writeFileSync('cfn-template.yaml', cfnTemplateArgs);
    console.log("cfn-template.yaml has been created!");
  }

  return 0;
}
