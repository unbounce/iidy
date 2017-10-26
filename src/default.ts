import * as _ from 'lodash';

export function def<T>(defaultVal: T, val?: T): T {
  return (_.isUndefined(val) || val === null) ? defaultVal : val;
}

export default def;
