import { S3 } from 'aws-sdk';
import { Md5 } from 'ts-md5/dist/md5';
import * as fs from 'fs';
import * as cli from 'cli-color';
import * as path from 'path';

import { Arguments } from 'yargs';
import { loadStackArgs, parseS3HttpUrl } from './cfn/index';
import configureAWS from './configureAWS';
import {logger} from './logger';

export async function requestApproveTemplate(argv: Arguments): Promise<number> {
  const stackArgs = await loadStackArgs(argv);
  const s3 = new S3();

  await configureAWS(stackArgs.Profile, stackArgs.Region);

  const cfnTemplate = await fs.readFileSync(stackArgs.Template);
  const s3Url = parseS3HttpUrl(stackArgs.ApprovedTemplateLocation);

  const hashedKey = path.join(
    s3Url.key,
    new Md5().appendStr(cfnTemplate.toString()).end().toString()
  );

  try {
    await s3.headObject({
      Bucket: s3Url.bucket,
      Key: `${hashedKey}.yaml`
    }).promise();

    logSuccess(`👍 Your template has already been approved`);
  } catch (e) {
    if (e.code === "NotFound") {
      await s3.putObject({
        Body: cfnTemplate,
        Bucket: s3Url.bucket,
        Key: `${hashedKey}${path.extname(stackArgs.Template)}.pending`
      }).promise();

      logSuccess(`Successfully uploaded the cloudformation template to ${stackArgs.ApprovedTemplateLocation}`);
      logSuccess(`Approve template with \`iidy approve ${hashedKey}.yaml\``);
    } else {
      throw new Error(e);
    }
  }

  return 0;
}

function logSuccess(text: string) {
  logger.info(cli.green(text));
}
