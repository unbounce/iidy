import {AWSRegion} from './aws-regions';
import * as yargs from 'yargs';

export {Argv, Options} from 'yargs';

export interface GlobalArguments {
  region?: AWSRegion;
  profile?: string;
  assumeRoleArn?: string;
  debug?: boolean;
  logFullError?: boolean;
  environment: string;
  clientRequestToken?: string;
}

export type GenericCLIArguments = GlobalArguments & yargs.Arguments;

export type ExitCode = number;
export type Handler = (args: GenericCLIArguments) => Promise<ExitCode>
//export type Handler<Args extends GenericCLIArguments> = (args: Args) => Promise<ExitCode>
