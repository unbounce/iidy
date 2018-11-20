import * as aws from 'aws-sdk';
import * as cli from 'cli-color';
import * as _ from 'lodash';
import def from '../default';
import {formatSectionHeading, formatTimestamp, printSectionEntry, renderTimestamp} from './formatting';
import {summarizeChangeSet} from "./summarizeChangeSet";

export async function showPendingChangesets(StackId: string, changeSetsPromise?: Promise<aws.CloudFormation.ListChangeSetsOutput>) {
  const cfn = new aws.CloudFormation();
  if (!changeSetsPromise) {
    changeSetsPromise = cfn.listChangeSets({StackName: StackId}).promise();
  }
  // TODO pagination if lots of changesets:
  let changeSets = def([], (await changeSetsPromise).Summaries);
  changeSets = _.sortBy(changeSets, (cs) => cs.CreationTime);
  if (changeSets.length > 0) {
    console.log();
    console.log(formatSectionHeading('Pending Changesets:'));
    for (const cs of changeSets) {
      printSectionEntry(formatTimestamp(renderTimestamp(cs.CreationTime as Date)), cli.magenta(cs.ChangeSetName) +
        ' ' +
        cs.Status +
        ' ' +
        def('', cs.StatusReason));
      if (!_.isEmpty(cs.Description)) {
        console.log('  Description:', cli.blackBright(cs.Description));
        console.log();
      }
      summarizeChangeSet(await cfn.describeChangeSet({StackName: StackId, ChangeSetName: cs.ChangeSetName!}).promise());
      console.log();
    }
  }
}
