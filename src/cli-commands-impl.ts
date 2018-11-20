import {Commands} from './cli-commands-type';
import {implementations as cfnImplementations} from './cfn/cli-command-impl';
import {demoMain} from './demo';
import {initStackArgs} from './initStackArgs';
import {renderMain} from './render';

export const implementations: Commands = {
  ...cfnImplementations,
  renderMain,
  demoMain,
  initStackArgs
};
