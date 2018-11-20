import * as _ from 'lodash';
import {readFromImportLocation, transform} from '../preprocess';
import maybeSignS3HttpUrl from './maybeSignS3HttpUrl';


// TODO is this used?
export async function loadCFNStackPolicy(policy: string | object | undefined, baseLocation: string): Promise<{
  StackPolicyBody?: string;
  StackPolicyURL?: string;
}> {
  if (_.isUndefined(policy)) {
    return {};
  }
  else if (_.isString(policy)) {
    const location0 = policy;
    const shouldRender = (location0.trim().indexOf('render:') === 0);
    const location = maybeSignS3HttpUrl(location0.trim().replace(/^ *render: */, ''));
    const importData = await readFromImportLocation(location, baseLocation);
    if (!shouldRender && importData.importType === 's3') {
      throw new Error(`Use https:// urls when using a plain (non-rendered) StackPolicy from S3: ${location}`);
      // note, s3 urls are valid for the shouldRender case below
    }
    else if (!shouldRender && importData.importType === 'http') {
      return {StackPolicyURL: importData.resolvedLocation};
    }
    else {
      return {
        StackPolicyBody: shouldRender
          ? JSON.stringify(await transform(importData.doc, importData.resolvedLocation), null, ' ')
          : importData.data
      };
    }
  }
  else if (_.isObject(policy)) {
    return {StackPolicyBody: JSON.stringify(policy)};
  }
  else {
    return {};
  }
}
