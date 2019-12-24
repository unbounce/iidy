import * as aws from 'aws-sdk';

import {writeLine} from '../output';
import {diff} from '../diff';
import {readFromImportLocation} from '../preprocess';
import * as yaml from '../yaml';
import {parseTemplateBody} from "./parseTemplateBody";
import {loadCFNTemplate} from "./loadCFNTemplate";
import {StackArgs} from './types';

export async function diffStackTemplates(StackName: string, stackArgs: StackArgs, argsfile: string, environment: string) {
  const cfn = new aws.CloudFormation();
  const {TemplateBody} = await cfn.getTemplate({StackName, TemplateStage: 'Original'}).promise();
  if (TemplateBody) {
    const oldTemplate = parseTemplateBody(TemplateBody);
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
    writeLine();
    diff(yaml.dump(oldTemplate), yaml.dump(newTemplate));
  }
}
