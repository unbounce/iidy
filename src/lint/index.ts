import * as _ from 'lodash';
import {Arguments} from 'yargs';

import {logger} from '../logger';
import * as yaml from '../yaml';
import {SUCCESS, FAILURE} from '../statusCodes';
import {loadStackArgs, loadCFNTemplate} from '../cfn/index';
import {lintTemplate} from '../cfn/lint';

export async function lintMain(argv: Arguments): Promise<number> {
  const stackArgs = await loadStackArgs(argv as any); // this calls configureAWS internally
  const cfnTemplate = await loadCFNTemplate(stackArgs.Template,
                                            argv.argsfile,
                                            argv.environment);
  if(cfnTemplate.TemplateBody) {
    const body = yaml.loadString(cfnTemplate.TemplateBody, stackArgs.Template);
    const lines = lintTemplate(body);
    for(const line of lines) {
      logger.warn(line);
    }

    return _.isEmpty(lines) ? SUCCESS : FAILURE;
  } else {
    logger.error('Unable to load template body');
    return FAILURE;
  }
}
