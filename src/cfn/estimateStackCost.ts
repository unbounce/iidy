import {writeLine} from '../output';
import {SUCCESS} from '../statusCodes';
import {AbstractCloudFormationStackCommand} from './AbstractCloudFormationStackCommand';
import {stackArgsToCreateStackInput} from './stackArgsToX';
import {CfnOperation} from './types';

export class EstimateStackCost extends AbstractCloudFormationStackCommand {
  cfnOperation: CfnOperation = 'ESTIMATE_COST';
  async _run() {
    const {TemplateBody, TemplateURL, Parameters} = await stackArgsToCreateStackInput(
      this.stackArgs, this.argsfile, this.environment, this.stackName);
    const estimateResp = await this.cfn.estimateTemplateCost({TemplateBody, TemplateURL, Parameters}).promise();
    writeLine('Stack cost estimator: ', estimateResp.Url);
    return SUCCESS;
  }
}
