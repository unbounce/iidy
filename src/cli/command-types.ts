import {Handler} from './types';
import {CfnStackCommands} from '../cfn/cli-types';

export interface MiscCommands {
  initStackArgs: Handler;
  renderMain: Handler;
  getImportMain: Handler;
  demoMain: Handler;
}

export interface Commands extends CfnStackCommands, MiscCommands {};
