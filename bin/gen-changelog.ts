import {spawnSync} from "child_process";
import * as yargs from 'yargs';
import * as dateformat from 'dateformat';
import * as Octokit from "@octokit/rest";

import {writeLine} from '../src/output';

const client = new Octokit();

const getTagDate = (tag: string) =>
  new Date(spawnSync(
    `git log -1 --format=%cd --date=local ${tag}`,
    {shell: true}).stdout.toString());

async function listPRs(prevTag: string, currentTag: string) {
  const startDate = getTagDate(prevTag);
  const endDate = getTagDate(currentTag);

  const pulls0: Octokit.PullsListResponseItem[] = await client.paginate(client.pulls.list.endpoint.merge({
    owner: 'unbounce',
    repo: 'iidy',
    state: 'closed',
    sort: 'updated',
    direction: 'desc',
  }));

  const pulls = pulls0
    .filter(
      pr => pr.merged_at
        && startDate < new Date(pr.merged_at)
        && new Date(pr.merged_at) < endDate
    ).sort(pr => pr.number);

  for (const pr of pulls) {
    writeLine(`- PR #${pr.number} by @${pr.user.login} - ${pr.title}`)
  }
};

async function writeReleaseNotes(prevTag: string, currentTag: string) {
  const releaseDate = getTagDate(currentTag);
  writeLine(`#### [${currentTag.replace('v', '')}](https://github.com/unbounce/iidy/compare/${prevTag}...${currentTag})`);
  writeLine();
  writeLine(dateformat(releaseDate, 'd mmmm yyyy'));
  writeLine();
  await listPRs(prevTag, currentTag)
}

async function main() {
  const args = yargs
    .option('from', {type: 'string'})
    .option('to', {type: 'string'})
    .option('include-header', {type: 'boolean', default: true})
    .demandOption(['from', 'to'])
    .parse();
  const currentTag = args.to;
  const prevTag = args.from;

  if (args.includeHeader) {
    writeLine('### Changelog');
    writeLine();
  }
  await writeReleaseNotes(prevTag, currentTag);
};

if (module.parent === null) {
  main();
};
