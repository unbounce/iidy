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

type Banner = {
  type: 'banner',
  banner: string}

type DemoCommand
  = {type: 'shell', script: string}
  | {type: 'silent', script: string}
  | {type: 'sleep', seconds: number}
  | {type: 'setenv', env: {[key: string]: any}}
  | Banner;

function normalizeRawCommand(raw: any): DemoCommand {
  if (typeof raw === 'string') {
    return {type: 'shell', script: raw};
  } else if (raw.setenv) {
    return {type: 'setenv', env: raw.setenv};
  } else if (raw.sleep) {
    return {type: 'sleep', seconds: raw.sleep};
  } else if (raw.silent) {
    return {type: 'silent', script: raw.silent};
  } else if (raw.banner) {
    return {type: 'banner', banner: raw.banner};
  } else {
    throw new Error(`Invalid demo command: ${raw}`);
  }
}

class DemoRunner {
  readonly demoscript: string;
  readonly timescaling: number;

  tmpdir: tmp.SynchrounousResult;
  bashEnv: typeof process.env;

  constructor(demoscript: string, timescaling=1) {
    this.demoscript = demoscript;
    this.bashEnv = _.merge({}, process.env);
    this.timescaling = timescaling;
  }

  async run(): Promise<number>{
    const demoFile = this.demoscript;
    const script0 = yaml.loadString(fs.readFileSync(demoFile), demoFile);
    const script: any = await transform(script0, demoFile);
    // TODO input validation using tv4 and json schema on ^
    this.tmpdir = tmp.dirSync();
    try {
      this._unpackFiles(script.files);
      await this._runCommands(_.map(script.demo, normalizeRawCommand));
    } catch (e) {
      throw e;
    } finally {
      // TODO check result
      child_process.execSync(`rm -r "${this.tmpdir.name}"`, {cwd: this.tmpdir.name });
    }
    return 0;
  }

  _unpackFiles(files: {[key: string]: string}) {
    for (let fp in files) {
      if (pathmod.isAbsolute(fp)) {
        throw new Error(`Illegal path ${fp}. Must be relative.`);
      }
      const fullpath = pathmod.resolve(this.tmpdir.name, fp);
      if (fp.indexOf(pathmod.sep) !== -1) {
        fs.mkdirSync(pathmod.dirname(fullpath));
      }
      fs.writeFileSync(fullpath, files[fp]);
    }
  }

  _execBashCommand(command: string) {
    let res = child_process.spawnSync(
      command,
      {shell: '/bin/bash',
       cwd: this.tmpdir.name,
       env: this.bashEnv,
       stdio: [0,1,2] });
    if (res.status !== 0) {
      // TODO improve this
      throw new Error(`command failed: ${command}. exitcode=${res.status}`);
    }
    console.log();
  }

  _displayBanner(command: Banner) {
    const bannerFormat = cli.bgXterm(236);
    console.log()
    const tty: any = process.stdout;
    console.log(bannerFormat(' '.repeat(tty.columns)));
    for (const ln of command.banner.split('\n')) {
      const pad = (tty.columns - ln.length);
      console.log(bannerFormat(cli.bold(cli.yellow(' '.repeat(2) + ln + ' '.repeat(pad-2)))));
    }
    console.log(bannerFormat(' '.repeat(tty.columns)));
    console.log();
  }

  async _printComm(command: string) {
    process.stdout.write(cli.red('Shell Prompt > '));
    process.stdout.write('\x1b[37m')
    for (let char of command) {
      process.stdout.write(char);
      await timeout(50 * this.timescaling);
    }
    process.stdout.write('\x1b[0m');
    console.log();
  }

  async _runCommands(commands: DemoCommand[]) {
    for (let command of commands) {
      // TODO logger
      switch(command.type) {
      case 'setenv':
        _.extend(this.bashEnv, command.env);
        break;
      case 'shell':
        await this._printComm(command.script);
        this._execBashCommand(command.script);
        break;
      case 'silent':
        this._execBashCommand(command.script);
        break;
      case 'sleep':
        await timeout(command.seconds * 1000 * this.timescaling);
        break;
      case 'banner':
        this._displayBanner(command);
        break;
      }
    }
  }
}

export async function demoMain(argv: Arguments): Promise<number> {
  return new DemoRunner(argv.demoscript, argv.timescaling).run()
}
