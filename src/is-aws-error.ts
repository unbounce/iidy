import type {AWSError} from 'aws-sdk/lib/error';

export default (err: unknown): err is AWSError => (err as AWSError).code !== undefined;
