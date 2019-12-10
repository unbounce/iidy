import * as fs from 'fs';
import * as glob from 'glob';
import {createHash} from 'crypto';

import normalizePath from './normalizePath';

const sha256sum = (filename: string) =>
  createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

/** Calculate a sha256 hash of a file or directory. */
export default (path0: string, format: 'hex' | 'base64' = 'hex') => {
  const path = normalizePath(path0);
  // this assumes local files/dirs TODO validate that
  if (!fs.existsSync(path)) {
    throw new Error(`Invalid path ${path} for filehash`);
  }
  const isDir = fs.lstatSync(path).isDirectory();

  let hexHash: string;
  if (isDir) {
    const files = glob.sync(`${path}/**`, {nodir: true});
    const fileHashes = files.map(sha256sum).join(",");
    hexHash = createHash('sha256').update(fileHashes).digest('hex');
  } else {
    hexHash = sha256sum(path);
  }

  switch (format) {
    case 'hex':
      return hexHash;
    case 'base64':
      return Buffer.from(hexHash, 'hex').toString('base64');
  }
}
