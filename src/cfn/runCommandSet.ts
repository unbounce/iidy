import * as child_process from 'child_process';
import * as cli from 'cli-color';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import * as _ from 'lodash';
import filehash from '../filehash';
import normalizePath from '../normalizePath';
import {interpolateHandlebarsString} from '../preprocess';

export function runCommandSet(commands: string[], cwd: string, handleBarsEnv?: object): string[] {
  // TODO: merge this with the demo script functionality see
  // https://stackoverflow.com/a/37217166 for a means of doing light
  // weight string templates of the input command
  // TODO might want to inject AWS_* envvars and helper bash functions as ENV vars
  console.log('==', 'Executing CommandsBefore from argsfile', '='.repeat(28));
  handlebars.registerHelper('filehash', (context: any) => filehash(normalizePath(cwd, context)));
  handlebars.registerHelper('filehashBase64', (context: any) => filehash(normalizePath(cwd, context), 'base64'));
  const expandedCommands: string[] = [];
  commands.forEach((command, index) => {
    const expandedCommand = interpolateHandlebarsString(command, handleBarsEnv || {}, "CommandsBefore");
    expandedCommands.push(expandedCommand);
    console.log(`\n-- Command ${index + 1}`, '-'.repeat(50));
    if (expandedCommand !== command) {
      console.log(cli.red('# raw command before processing handlebars variables:'));
      console.log(cli.blackBright(command));
      console.log(cli.red('# command after processing handlebars variables:'));
      console.log(cli.blackBright(expandedCommand));
    }
    else {
      console.log(cli.blackBright(command));
    }
    const shellEnv = _.merge({
      'BASH_FUNC_iidy_filehash%%': `() {   shasum -p -a 256 "$1" | cut -f 1 -d ' '; }`,
      'BASH_FUNC_iidy_filehash_base64%%': `() { shasum -p -a 256 "$1" | cut -f 1 -d ' ' | xxd -r -p | base64; }`,
      'BASH_FUNC_iidy_s3_upload%%': `() {
  echo '>> NOTE: iidy_s3_upload is an experimental addition to iidy. It might be removed in future versions.'
  FILE=$1
  BUCKET=$2
  S3_KEY=$3
  aws --profile "$iidy_profile" --region "$iidy_region" s3api head-object --bucket "$BUCKET" --key "$S3_KEY" 2>&1 >/dev/null || \
        aws --profile "$iidy_profile" --region "$iidy_region" s3 cp "$FILE" "s3://$BUCKET/$S3_KEY";

 }`,
      // flatten out the environment to pass through
      'iidy_profile': _.get(handleBarsEnv, 'iidy.profile'),
      'iidy_region': _.get(handleBarsEnv, 'iidy.region'),
      'iidy_environment': _.get(handleBarsEnv, 'iidy.environment')
    }, process.env);
    shellEnv.PKG_SKIP_EXECPATH_PATCH = 'yes';
    // ^ workaround for https://github.com/zeit/pkg/issues/376
    const spawnOptions = {
      cwd,
      shell: fs.existsSync('/bin/bash') ? '/bin/bash' : true,
      // TODO color stderr
      stdio: [0, 1, 2],
      // TODO extract definition of iidy_s3_upload to somewhere else
      env: shellEnv
    };
    console.log('--', `Command ${index + 1} Output`, '-'.repeat(25));
    const result = child_process.spawnSync(expandedCommand, [], spawnOptions);
    if (result.status > 0) {
      throw new Error(`Error running command (exit code ${result.status}):\n` + command);
    }
  });
  handlebars.unregisterHelper('filehash');
  console.log();
  console.log('==', 'End CommandsBefore', '='.repeat(48));
  console.log();
  return expandedCommands;
}
