import {Commands} from './command-types';
import {implementations as cfnImplementations} from '../cfn/cli-command-impl';
import {demoMain} from '../demo';
import {lintMain} from '../cfn/lint';
import {initStackArgs} from '../initStackArgs';
import {renderMain} from '../render';
import {getImportMain} from '../getImport';

export const implementations: Commands = {
  ...cfnImplementations,
  lintMain,
  renderMain,
  getImportMain,
  demoMain,
  initStackArgs
};
