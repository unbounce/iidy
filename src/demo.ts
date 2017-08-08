import * as fs from 'fs';
import * as pathmod from 'path';
import * as child_process from 'child_process';

import * as _ from 'lodash';
import {Arguments} from 'yargs';
import * as tmp from 'tmp';
import * as cli from 'cli-color';


import timeout from './timeout';
import { transform } from './index';
import * as yaml from './yaml';

export async function demoMain(argv: Arguments): Promise<number> {
  const demoFile = argv.demoscript;
  const script0 = yaml.loadString(fs.readFileSync(demoFile), demoFile);
  const script: any = await transform(script0, demoFile);
  let tmpdir = tmp.dirSync();
  try {
    for (let fp in script.files) {
      if (pathmod.isAbsolute(fp)) {
        throw new Error(`Illegal path ${fp}. Must be relative.`);
      }
      const fullpath = pathmod.resolve(tmpdir.name, fp)
      if (fp.indexOf(pathmod.sep) !== -1) {
        fs.mkdirSync(pathmod.dirname(fullpath))
      }
      fs.writeFileSync(fullpath, script.files[fp]);
    }
    let bashEnv = _.merge({}, process.env);
    const exec = (command: string, captureAs?: string) => {
      let res = child_process.spawnSync(
        command,
        {shell: '/bin/bash',
         cwd: tmpdir.name,
         env: bashEnv,
         stdio: [0,1,2] })
      if (res.status !== 0) {
        // TODO improve this
        throw new Error(`command failed: ${command}. exitcode=${res.status}`)
      }
      console.log();

    }
    async function printComm(command: string) {
      process.stdout.write(cli.red('Shell Prompt > '));
      process.stdout.write('\x1b[37m')
      for (let char of command) {
        process.stdout.write(char);
        await timeout(50);
      }
      process.stdout.write('\x1b[0m')
      console.log();
    }
    // prompt:, capture:
    for (let command of script.demo) {
      if (typeof command === 'string') {
        await printComm(command);
        exec(command)
      } else if (command.do) {
        await printComm(command.show);
        exec(command.do)
      } else if (command.setenv) {
        _.extend(bashEnv, command.setenv)
      } else if (command.sleep) {
        await timeout(command.sleep * 1000);
      } else if (command.silent) {
        // logger
        exec(command.silent)
      } else if (command.banner) {
        console.log()
        const tty: any = process.stdout;
        const bannerFormat = cli.bgXterm(236);
        console.log(bannerFormat(' '.repeat(tty.columns)));
        for (const ln of command.banner.split('\n')) {
          const pad = (tty.columns - ln.length);
          console.log(bannerFormat(cli.bold(cli.yellow(' '.repeat(2) + ln + ' '.repeat(pad-2)))));
        }
        console.log(bannerFormat(' '.repeat(tty.columns)));
        console.log()
      } else {
        console.log(command);
      }
    }

  } catch (e) {
    throw e;
  } finally {
    // TODO check result
    child_process.execSync(`rm -r ${tmpdir.name}`, {cwd: tmpdir.name })
  }
  return 0;
}
