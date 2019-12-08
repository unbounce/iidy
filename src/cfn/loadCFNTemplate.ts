import * as _ from 'lodash';
import getCurrentAWSRegion from '../getCurrentAWSRegion';
import {PreprocessOptions, readFromImportLocation, transform} from '../preprocess';
import * as yaml from '../yaml';
import maybeSignS3HttpUrl from './maybeSignS3HttpUrl';

export async function loadCFNTemplate(location0: string, baseLocation: string, environment: string, options: PreprocessOptions = {}): Promise<{
  TemplateBody?: string;
  TemplateURL?: string;
}> {
  if (_.isUndefined(location0)) {
    return {};
  }
  const TEMPLATE_MAX_BYTES = 51199;
  const shouldRender = (location0.trim().indexOf('render:') === 0);
  const location = maybeSignS3HttpUrl(location0.trim().replace(/^ *render: */, ''));
  // We auto-sign any s3 http urls here ^ prior to reading from them
  // (via readFromImportLocation below) or passing them to CFN via
  // TemplateUrl. This allows iidy to handle cross-region
  // TemplateUrls. s3:// urls don't provide any means of encoding
  // the source region and CFN doesn't accept them.
  // TODO maybeSignS3HttpUrl might need updating later if we add
  // support for baseLocation here being an http url itself: i.e.
  // relative imports. This is probably an edge-case we don't need to
  // support but it's worth noting.
  if (!shouldRender && location.match(/^s3:/)) {
    throw new Error(`Use https:// S3 path-based urls when using a plain (non-rendered) Template from S3: ${location}`);
    // note, s3 urls are valid for the shouldRender case below
  }
  else if (!shouldRender && location.match(/^http/)) {
    // note the handling of unsigned s3 http urls above in maybeSignS3HttpUrl ^
    return {TemplateURL: location};
  }
  else {
    const importData = await readFromImportLocation(location, baseLocation);
    if (importData.data.indexOf('$imports:') > -1 && !shouldRender) {
      throw new Error(`Your cloudformation Template from ${location} appears to`
        + ' use iidy\'s yaml pre-processor syntax.\n'
        + ' You need to prefix the template location with "render:".\n'
        + ` e.g.   Template: "render:${location}"`);
    }
    importData.doc.$envValues = _.merge({}, importData.doc.$envValues, {iidy: {environment: environment, region: getCurrentAWSRegion()}});
    const body = shouldRender
      ? yaml.dump(await transform(importData.doc, importData.resolvedLocation, options))
      : importData.data;
    if (body.length >= TEMPLATE_MAX_BYTES) {
      throw new Error('Your cloudformation template is larger than the max allowed size. '
        + 'You need to upload it to S3 and reference it from there.');
    }
    return {TemplateBody: body};
  }
}
