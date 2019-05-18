import {CfnStackCommands} from './cli-types';
import {
  createStackMain,
  createOrUpdateStackMain,
  updateExistingMain,
  updateStackMain,
  executeChangesetMain,
  estimateCost
} from './index';
import {describeStackMain} from './describeStack';
import {getStackInstancesMain} from './getStackInstances';
import {getStackTemplateMain} from './getStackTemplate';
import {listStacksMain} from './listStacks';
import {watchStackMain} from './watchStack';
import {deleteStackMain} from './deleteStack';
import {createChangesetMain} from './createChangeset';
import {convertStackToIIDY} from './convertStackToIidy';
import {describeStackDriftMain} from './drift';
import {lintMain} from './lint';

export const implementations: CfnStackCommands = {
  // TODO rename these do be consistent
  createStackMain,
  createOrUpdateStackMain,
  updateExistingMain,
  updateStackMain,
  listStacksMain,
  watchStackMain,
  describeStackMain,
  describeStackDriftMain,
  getStackTemplateMain,
  getStackInstancesMain,
  deleteStackMain,

  createChangesetMain,
  executeChangesetMain,

  estimateCost,

  convertStackToIIDY,
  lintMain

};
