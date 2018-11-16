import * as aws from 'aws-sdk';
import * as _ from 'lodash';
import def from '../default';
import {logger} from '../logger';

export async function getAllStackExportsWithImports(StackId: string) {
  const cfn = new aws.CloudFormation();
  let res = await cfn.listExports().promise();
  const filterAndGetImports = (exportList: aws.CloudFormation.Exports) => exportList
    .filter(ex => ex.ExportingStackId === StackId)
    .map(ex => {
      return {
        Name: ex.Name,
        Value: ex.Value,
        Imports: cfn.listImports({ExportName: ex.Name as string})
          .promise()
          .catch(e => {
            logger.debug(e); // no imports found
            return {Imports: []};
          })
      };
    });
  let exports = filterAndGetImports(def([], res.Exports));
  while (!_.isUndefined(res.NextToken)) {
    res = await cfn.listExports({NextToken: res.NextToken}).promise();
    exports = exports.concat(filterAndGetImports(def([], res.Exports)));
  }
  return exports;
}
