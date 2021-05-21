import {S3, AWSError} from 'aws-sdk';
import * as cli from 'cli-color';
import * as _ from 'lodash';
import * as path from 'path';
import * as url from 'url';
import {GlobalArguments} from '../../cli/utils';
import configureAWS from '../../configureAWS';
import confirmationPrompt from '../../confirmationPrompt';
import {diff} from '../../diff';
import {logger} from '../../logger';
import {FAILURE, INTERRUPT, SUCCESS} from '../../statusCodes';
import {approvedTemplateVersionLocation} from "../approvedTemplateVersionLocation";
import {loadCFNTemplate, S3_TEMPLATE_MAX_BYTES} from "../loadCFNTemplate";
import {loadStackArgs} from "../loadStackArgs";
import {lintTemplate} from '../lint';

export type RequestArguments = GlobalArguments & {
  argsfile: string;
  lintUsingParameters: boolean;
  lintTemplate: boolean;
};

export async function request(argv: RequestArguments): Promise<number> {
  const stackArgsKeys = ['ApprovedTemplateLocation', 'Template'];
  if (argv.lintUsingParameters) {
    stackArgsKeys.push('Parameters');
  }
  const stackArgs = await loadStackArgs(argv as any, stackArgsKeys); // this calls configureAWS internally

  if (typeof stackArgs.ApprovedTemplateLocation === "string" && stackArgs.ApprovedTemplateLocation.length > 0) {
    const s3 = new S3();
    const s3Args = await approvedTemplateVersionLocation(stackArgs.ApprovedTemplateLocation, stackArgs.Template, argv.argsfile, argv.environment);

    try {
      await s3.headObject(s3Args).promise();
      logSuccess(`👍 Your template has already been approved`);
    } catch (e) {
      if (e instanceof AWSError && e.code === "NotFound") {
        s3Args.Key = `${s3Args.Key}.pending`
        const cfnTemplate = await loadCFNTemplate(stackArgs.Template, argv.argsfile, argv.environment, {omitMetadata: true}, S3_TEMPLATE_MAX_BYTES);
        if (argv.lintTemplate && cfnTemplate.TemplateBody) {
          const errors = lintTemplate(cfnTemplate.TemplateBody, stackArgs.Parameters);
          if (!_.isEmpty(errors)) {
            logger.error(`CFN template validation failed with ${errors.length} error${errors.length > 1 ? 's' : ''}:`)
            for(const error of errors) {
              logger.error(error);
            }
            return FAILURE;
          }
        }
        await s3.putObject({
          Body: cfnTemplate.TemplateBody,
          ACL: 'bucket-owner-full-control',
          ...s3Args
        }).promise();

        logSuccess(`Successfully uploaded the cloudformation template to ${stackArgs.ApprovedTemplateLocation}`);
        logSuccess(`Approve template with:\n  iidy template-approval review s3://${s3Args.Bucket}/${s3Args.Key}`);
      } else {
        throw e;
      }
    }

    return SUCCESS;
  } else {
    logError(`\`ApprovedTemplateLocation\` must be provided in ${argv.argsfile}`);
    return FAILURE;
  }

}

export type ReviewArguments = GlobalArguments & {
  url: string;
};

export async function review(argv: ReviewArguments): Promise<number> {
  await configureAWS(_.merge({}, argv, {region: 'us-east-1'})); // TODO why is this hard-coded to us-east-1?
  const s3 = new S3();

  const s3Url = url.parse(argv.url);
  const s3Path = s3Url.path ? s3Url.path.replace(/^\//, '') : '';
  const s3Bucket = s3Url.hostname ? s3Url.hostname : '';

  const bucketDir = path.parse(s3Path).dir;

  try {
    await s3.headObject({
      Bucket: s3Bucket,
      Key: s3Path.replace(/\.pending$/, '')
    }).promise();

    logSuccess(`👍 The template has already been approved`);
  } catch (e) {
    if (e instanceof AWSError && e.code === 'NotFound') {

      const pendingTemplate = await s3.getObject({
        Bucket: s3Bucket,
        Key: s3Path
      }).promise().then((template) => template.Body);

      const previouslyApprovedTemplate = await s3.getObject({
        Bucket: s3Bucket,
        Key: `${bucketDir}/latest`
      }).promise()
        .then((template) => template.Body)
        .catch((e) => {
          if (e.code !== 'NoSuchKey') {
            return Promise.reject(e);
          } else {
            return Promise.resolve(Buffer.from(''));
          }
        });

      diff(
        previouslyApprovedTemplate!.toString(),
        pendingTemplate!.toString(),
        500
      );

      const confirmed = await confirmationPrompt('Would you like to approve these changes?');
      if (confirmed) {
        // create a new pending file
        await s3.putObject({
          Body: pendingTemplate,
          Bucket: s3Bucket,
          Key: s3Path.replace(/\.pending$/, '')
        }).promise();
        logDebug('Created a new cfn-template');

        // copy to latest
        await s3.putObject({
          Body: pendingTemplate,
          Bucket: s3Bucket,
          Key: `${bucketDir}/latest`
        }).promise();
        logDebug('Updated latest');

        // delete the old pending file
        await s3.deleteObject({
          Bucket: s3Bucket,
          Key: s3Path
        }).promise();
        logDebug('Deleted pending file.');

        console.log();
        logSuccess(`Template has been successfully approved!`);
        return SUCCESS;
      } else {
        return INTERRUPT;
      }

    } else {
      throw e;
    }
  }

  return SUCCESS;
}

function logSuccess(text: string) {
  logger.info(cli.green(text));
}

function logDebug(text: string) {
  logger.debug(text);
}

function logError(text: string) {
  logger.error(cli.red(text));
}
