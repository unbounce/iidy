import { S3 } from 'aws-sdk';
import * as fs from 'fs';
import * as cli from 'cli-color';
import { Md5 } from 'ts-md5/dist/md5';

import { Arguments } from 'yargs';
import { loadStackArgs, parseS3HttpUrl } from './cfn/index';
import configureAWS from './configureAWS';

export async function requestApproveTemplate(argv: Arguments): Promise<number> {
  const stackArgs = await loadStackArgs(argv);
  const s3 = new S3();

  await configureAWS(stackArgs.Profile, stackArgs.Region);

  const cfnTemplate = await fs.readFileSync(stackArgs.Template);
  const cfnTemplateFileName = stackArgs.Template.match(/[a-zA-Z-_0-9]*\.yaml/)![0];
  const s3Url = parseS3HttpUrl(stackArgs.ApprovedTemplateLocation);

  let hashedKey = new Md5().appendStr(cfnTemplate.toString()).end().toString();

  if (s3Url.key.length > 0) {
    hashedKey = `${s3Url.key}/${hashedKey}`;
  }

  try {
    await s3.headObject({
      Bucket: s3Url.bucket,
      Key: `${hashedKey}.yaml`
    }, undefined).promise();

    logSuccess(`👍 Your template has already been approved`);
  } catch (e) {
    if (e.code === "NotFound") {
      await s3.putObject({
        Body: cfnTemplate,
        Bucket: s3Url.bucket,
        Key: `${hashedKey}.yaml.pending`
      }, undefined).promise();

      logSuccess(`Successfully uploaded ${cfnTemplateFileName} to ${stackArgs.ApprovedTemplateLocation}`);
      logSuccess(`Approve template with \`iidy approve ${hashedKey}.yaml\``);
    } else {
      throw new Error(e)
    }
  }

  return 0
}

function logSuccess(text: string) {
  console.log(cli.green(text))
}
