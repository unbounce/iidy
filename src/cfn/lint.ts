import * as _ from 'lodash';
import * as laundry from 'laundry-cfn';

import {Arguments} from 'yargs';

import {logger} from '../logger';
import * as yaml from '../yaml';
import {SUCCESS, FAILURE} from '../statusCodes';
import {loadStackArgs} from './loadStackArgs';
import {loadCFNTemplate} from './loadCFNTemplate';

export function lintTemplate(input: string): string[] {
  const errors = laundry.lint(input);
  return _.map(errors, (error) => {
    return `${error.path.join('.')}: ${error.message}`;
  });
}

export async function lintMain(argv: Arguments): Promise<number> {
  const stackArgs = await loadStackArgs(argv as any); // this calls configureAWS internally
  const cfnTemplate = await loadCFNTemplate(stackArgs.Template,
                                            argv.argsfile,
                                            argv.environment);
  if(cfnTemplate.TemplateBody) {
    const lines = lintTemplate(cfnTemplate.TemplateBody);
    for(const line of lines) {
      logger.warn(line);
    }

    return _.isEmpty(lines) ? SUCCESS : FAILURE;
  } else {
    logger.error('Unable to load template body');
    return FAILURE;
  }
}
