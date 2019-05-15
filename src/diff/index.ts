import * as pathmod from 'path';
import * as tmp from 'tmp';
import * as fs from 'fs';
import * as child_process from 'child_process';

import {logger} from '../logger';

export function diff(a: string, b: string, context = 3): boolean {
  const tmpdir = tmp.dirSync();
  const aPath = pathmod.join(tmpdir.name, 'a');
  const bPath = pathmod.join(tmpdir.name, 'b');
  try {
    fs.writeFileSync(aPath, a);
    fs.writeFileSync(bPath, b);
    // git-diff is used as it is the easist way to get a cross-platform colour diff
    const cmd = `git --no-pager diff --no-index -U${context} --color -- ${aPath} ${bPath}`;
    const res = child_process.spawnSync(
      cmd, {
        shell: '/bin/sh',
        stdio: [0, 1, 2]
      }
    );

    if (res.status === 0) {
      logger.info('Templates are the same');
      return true;
    } else if (res.status !== 1) {
      throw new Error(`Error producing diff "${cmd}"`);
    } else {
      return false;
    }
  } catch (e) {
    throw e;
  } finally {
    fs.unlinkSync(aPath);
    fs.unlinkSync(bPath);
    fs.rmdirSync(tmpdir.name);
  }
}
