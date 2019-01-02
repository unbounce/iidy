import {Commands} from './command-types';
import {implementations as cfnImplementations} from './command-implemntations';
import {demoMain} from '../demo';
import {lintMain} from '../cfn/lint';
import {initStackArgs} from '../initStackArgs';
import {renderMain} from '../render';

export const implementations: Commands = {
  ...cfnImplementations,
  lintMain,
  renderMain,
  demoMain,
  initStackArgs
};
