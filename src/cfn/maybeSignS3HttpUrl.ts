import * as aws from 'aws-sdk'
import * as url from 'url';

function parseS3HttpUrl(input: string) {
  const uri = url.parse(input);

  if (typeof uri === "undefined") {
    throw new Error(`HTTP URL '${input}' is not a well-formed S3 URL`);
  } else {
    let bucket, key, region;
    const hostname = uri.hostname || '';
    const pathname = decodeURIComponent(uri.pathname || '');

    if (/^s3[\.-](\w{2}-\w{4,9}-\d\.)?amazonaws\.com/.test(hostname)) {
      bucket = pathname.split('/')[1];
      key = pathname.split('/').slice(2).join('/');
    } else if (/\.s3[\.-](\w{2}-\w{4,9}-\d\.)?amazonaws\.com/.test(hostname)) {
      bucket = hostname.split('.')[0];
      key = pathname.slice(1);
    } else {
      throw new Error(`HTTP URL '${input}' is not a well-formed S3 URL`);
    }

    if (/^s3\.amazonaws\.com/.test(uri.hostname || '')) {
      region = 'us-east-1';
    } else {
      const match = hostname.match(/^s3[\.-](\w{2}-\w{4,9}-\d)?.amazonaws\.com/) || [];
      if (match[1]) {
        region = match[1];
      } else {
        throw new Error(`HTTP URL '${input}' is not a well-formed S3 URL`);
      }
    }

    return {bucket, key, region}
  }
}

export default function maybeSignS3HttpUrl(location: string) {
  const isUnsignedS3HttpUrl = location.match(/^http/) && location.match(/s3/) && !location.match(/Signature=/);
  if (isUnsignedS3HttpUrl) {
    const params = parseS3HttpUrl(location);
    const s3 = new aws.S3({region: params.region});
    return s3.getSignedUrl('getObject', {Bucket: params.bucket, Key: params.key});
  }
  else {
    return location;
  }
}
