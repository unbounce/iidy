import * as aws from 'aws-sdk'
import * as _ from 'lodash';

export default (obj: object): aws.CloudFormation.Tags =>
  _.map(_.toPairs(obj),
    // TODO handle UsePreviousValue for updates
    ([Key, Value]) => {return {Key, Value: Value.toString()}});
