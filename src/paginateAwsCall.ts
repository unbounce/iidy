import * as _ from 'lodash';

import def from './default';

// TODO fix the types on this so inference is preserved
// See my broken attempt below.
export type AwsApiCall<A, T> = (_: A) => ({promise: () => Promise<T>});
export async function paginateAwsCall
  <A, T extends {NextToken?: string}, R>
  (fetcher: AwsApiCall<A, T>, args: A, selector: string): Promise<R[]> {
  let resp: T = await fetcher(args).promise();
  let results: R[] = def([], _.get(resp, selector));
  while (!_.isUndefined(resp.NextToken)) {
    resp = await fetcher(_.merge({NextToken: resp.NextToken}, args)).promise();
    results.concat(def([], _.get(resp, selector)));
  }
  return results;
}

export default paginateAwsCall;

// // TODO for this to work I need some way of asserting that T[K] is an array
// type AwsApiCall<A, T> = (_: A) => ({promise: () => Promise<T>});
// async function paginateAwsCall<A, T extends {NextToken?: string}, K extends keyof T>
//   (fetcher: AwsApiCall<A, T>, args: A, selector: K)
//   : Promise<T[K]> {
//   let resp = await fetcher(args).promise();
//   let results = resp[selector] || [];
//   while (!_.isUndefined(resp.NextToken)) {
//     resp = await fetcher(_.merge({NextToken: resp.NextToken}, args)).promise();
//     results.concat(resp[selector] || []);
//   }
//   return results;
// }
