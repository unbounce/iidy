import { S3 } from 'aws-sdk';
import { Md5 } from 'ts-md5/dist/md5';
import * as fs from 'fs';
import * as cli from 'cli-color';
import * as path from 'path';
import * as url from 'url';

import { Arguments } from 'yargs';
import { loadStackArgs, parseS3HttpUrl } from './cfn/index';
import configureAWS from './configureAWS';
import {logger} from './logger';

export async function requestApproveTemplate(argv: Arguments): Promise<number> {
  const stackArgs = await loadStackArgs(argv);
  const s3 = new S3();

  await configureAWS(stackArgs.Profile, stackArgs.Region);

  const cfnTemplate = await fs.readFileSync(stackArgs.Template);
  const approvedTemplateLocation = stackArgs.ApprovedTemplateLocation ? stackArgs.ApprovedTemplateLocation : "";

  const s3Url = url.parse(approvedTemplateLocation);
  const s3Path = s3Url.path ? s3Url.path : "";
  const s3Bucket = s3Url.hostname ? s3Url.hostname : "";

  const fileName = new Md5().appendStr(cfnTemplate.toString()).end().toString()
  const fullFileName = `${fileName}${path.extname(stackArgs.Template)}`

  const hashedKey = path.join(s3Path, fullFileName);

  try {
    await s3.headObject({
      Bucket: s3Bucket,
      Key: fullFileName
    }).promise();

    logSuccess(`👍 Your template has already been approved`);
  } catch (e) {
    if (e.code === "NotFound") {
      await s3.putObject({
        Body: cfnTemplate,
        Bucket: s3Bucket,
        Key: `${fullFileName}.pending`
      }).promise();

      logSuccess(`Successfully uploaded the cloudformation template to ${approvedTemplateLocation}`);
      logSuccess(`Approve template with \`iidy approve ${fullFileName}\``);
    } else {
      throw new Error(e);
    }
  }

  return 0;
}

function logSuccess(text: string) {
  logger.info(cli.green(text));
}
