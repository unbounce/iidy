import * as pathmod from 'path';
import {Md5} from 'ts-md5';
import * as url from 'url';
import {loadCFNTemplate, S3_TEMPLATE_MAX_BYTES} from "./loadCFNTemplate";

export async function approvedTemplateVersionLocation(approvedTemplateLocation: string, templatePath: string, baseLocation: string, environment: string): Promise<{
  Bucket: string;
  Key: string;
}> {
  // const templatePath = path.resolve(path.dirname(location), templatePath);
  // const cfnTemplate = await fs.readFileSync(path.resolve(path.dirname(location), templatePath));
  const cfnTemplate = await loadCFNTemplate(templatePath, baseLocation, environment, {omitMetadata: true}, S3_TEMPLATE_MAX_BYTES);
  if (cfnTemplate && cfnTemplate.TemplateBody) {
    const s3Url = url.parse(approvedTemplateLocation);
    const s3Path = s3Url.path ? s3Url.path : "";
    const s3Bucket = s3Url.hostname ? s3Url.hostname : "";
    const fileName = new Md5().appendStr(cfnTemplate.TemplateBody.toString()).end().toString();
    const fullFileName = `${fileName}${pathmod.extname(templatePath)}`;
    return {
      Bucket: s3Bucket,
      Key: pathmod.join(s3Path.substring(1), fullFileName)
    };
  }
  else {
    throw new Error('Unable to determine versioned template location');
  }
}
