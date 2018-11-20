import * as yaml from '../yaml';

export function parseTemplateBody(templateBody: string): object {
  if (templateBody.match(/^ *\{/) !== null) {
    return JSON.parse(templateBody);
  }
  else {
    return yaml.loadString(templateBody, '');
  }
}
