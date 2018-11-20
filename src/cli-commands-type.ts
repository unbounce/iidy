import {Handler} from './cli-types';
import {CfnStackCommands} from './cfn/cli-types';

export interface MiscCommands {
  initStackArgs: Handler;
  renderMain: Handler;
  demoMain: Handler;
}

export interface Commands extends CfnStackCommands, MiscCommands {};
