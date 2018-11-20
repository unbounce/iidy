import * as fs from 'fs';
import * as child_process from 'child_process';

import normalizePath from './normalizePath';

/** Calculate a sha256 hash of a file or directory. */
export default (path0: string, format: 'hex'|'base64' = 'hex') => {
  const path = normalizePath(path0);
  // this assumes local files/dirs TODO validate that
  if (!fs.existsSync(path)) {
    throw new Error(`Invalid path ${path} for filehash`);
  }
  const isDir = fs.lstatSync(path).isDirectory();
  const shasumCommand = 'shasum -p -a 256';
  const hashCommand = isDir
    ? `find ${path} -type f -print0 | xargs -0 ${shasumCommand} | ${shasumCommand}`
    : `${shasumCommand} ${path}`;

  const result = child_process.spawnSync(hashCommand, [], {shell: true});
  const hexHash = result.stdout.toString().trim().split(' ')[0];
  switch (format) {
    case 'hex':
      return hexHash;
    case 'base64':
      return Buffer.from(hexHash, 'hex').toString('base64');
  }
}
