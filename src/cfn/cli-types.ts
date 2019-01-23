import {Handler} from '../cli/types';

export interface CfnStackCommands {
  createStackMain: Handler;
  createOrUpdateStackMain: Handler;
  updateStackMain: Handler;
  listStacksMain: Handler;
  watchStackMain: Handler;
  describeStackMain: Handler;
  describeStackDriftMain: Handler;
  getStackTemplateMain: Handler;
  getStackInstancesMain: Handler;
  deleteStackMain: Handler;

  estimateCost: Handler; // TODO fix inconsistent name

  createChangesetMain: Handler;
  executeChangesetMain: Handler;
  // TODO add an activate stack command wrapper
  convertStackToIIDY: Handler;
  lintMain: Handler
}
