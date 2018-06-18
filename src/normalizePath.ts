import * as pathmod from 'path';
import * as _ from 'lodash';

function resolveHome(path: string): string {
  if (path[0] === '~') {
    return pathmod.join(process.env.HOME as string, path.slice(1));
  } else {
    return path;
  }
}

/** Resolves ~/ in path segments then applies path.resolve to join and normalize the segments. */
export default (...pathSegments: string[]): string =>
  pathmod.resolve.apply(pathmod, _.map(pathSegments, (path) => resolveHome(path.trim())));
