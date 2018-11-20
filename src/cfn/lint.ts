import * as _ from 'lodash';
import {validateJsonObject} from 'cfn-lint';

export function lintTemplate(input: object): string[] {
  const result = [];
  const {errors} = validateJsonObject(input);

  for(const error of _.concat(errors.crit, errors.warn, errors.info)) {
    if(error.resource) {
      result.push(`${error.resource}: ${error.message}`);
    } else {
      result.push(error.message);
    }
  }

  return result;
}
