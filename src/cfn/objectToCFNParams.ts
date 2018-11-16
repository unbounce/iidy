import * as aws from 'aws-sdk'
import * as _ from 'lodash';

export default (obj: {[key: string]: string}): aws.CloudFormation.Parameters =>
  _.map(_.toPairs(obj),
    // TODO handle UsePreviousValue for updates
    ([ParameterKey, ParameterValue]) => {
      return {ParameterKey, ParameterValue: ParameterValue.toString()}
    })
