import { S3 } from 'aws-sdk'
import * as fs from 'fs';
import * as cli from 'cli-color';

import {Arguments} from 'yargs';
import {loadStackArgs, createStackMain} from './cfn/index';
import configureAWS from './configureAWS';

export async function publishApprovedTemplate(argv: Arguments): Promise<number> {
  await configureAWS('sandbox', 'us-east-1');

  const stackArgs = await loadStackArgs(argv);
  const s3        = new S3();

  if (stackArgs.ApprovedTemplateLocation === undefined ||
      stackArgs.ApprovedTemplateLocation.length <= 0 ) {
    throw new Error("Missing key: `ApprovedTemplateLocation`")
  }

  var cfnTemplate = await fs.readFileSync(stackArgs.Template)
  var bucket      = stackArgs.ApprovedTemplateLocation.substr(5).slice(0,-1)
  var key         = stackArgs.Template.replace("./","")
  var params      = { Body: cfnTemplate, Bucket: bucket, Key: key, }

  await s3.putObject(params).promise()
  console.log(cli.green(`Successfully uploaded ${key} to ${bucket}`))

  if ( argv.publishTemplate ) { await createStackMain(argv); }

  return 0
}
