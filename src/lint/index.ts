import * as _ from 'lodash';
import {validateJsonObject} from 'cfn-lint';
import {Arguments} from 'yargs';

import {logger} from '../logger';
import * as yaml from '../yaml';
import {SUCCESS, FAILURE} from '../statusCodes';
import {loadStackArgs, loadCFNTemplate} from '../cfn/index';

export function lint(input: object): string[] {
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

export async function lintMain(argv: Arguments): Promise<number> {
  const stackArgs = await loadStackArgs(argv as any); // this calls configureAWS internally
  const cfnTemplate = await loadCFNTemplate(stackArgs.Template,
                                            argv.argsfile,
                                            argv.environment);
  if(cfnTemplate.TemplateBody) {
    const body = yaml.loadString(cfnTemplate.TemplateBody, stackArgs.Template);
    const lines = lint(body);
    for(const line of lines) {
      logger.warn(line);
    }

    return _.isEmpty(lines) ? SUCCESS : FAILURE;
  } else {
    logger.error('Unable to load template body');
    return FAILURE;
  }
}
