import * as aws from 'aws-sdk';
import {diff} from '../diff';
import {readFromImportLocation} from '../preprocess';
import * as yaml from '../yaml';
import {loadCFNTemplate, parseTemplateBody} from './index';
import {StackArgs} from './types';

export async function diffStackTemplates(StackName: string, stackArgs: StackArgs, argsfile: string, environment: string) {
  const cfn = new aws.CloudFormation();
  const {TemplateBody} = await cfn.getTemplate({StackName, TemplateStage: 'Original'}).promise();
  if (TemplateBody) {
    let oldTemplate = parseTemplateBody(TemplateBody);
    const {TemplateBody: newTemplateBody,
      TemplateURL: newTemplateURL} = await loadCFNTemplate(stackArgs.Template, argsfile, environment);
    let newTemplate: object;
    if (newTemplateURL) {
      const importData = await readFromImportLocation(newTemplateURL, argsfile);
      newTemplate = importData.doc;
    }
    else if (newTemplateBody) {
      newTemplate = parseTemplateBody(newTemplateBody);
    }
    else {
      throw new Error('Invalid template found');
    }
    console.log();
    diff(yaml.dump(oldTemplate), yaml.dump(newTemplate));
  }
}
