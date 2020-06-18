// See
// https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-describing-stacks.html
// and http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-listing-event-history.html

// export const ACTION_PREFIXES = [
//   'CREATE',
//   'REVIEW',
//   'ROLLBACK',
//   'DELETE',
//   'UPDATE',
//   'IMPORT',
// ] as const;
// export type ACTION_PREFIXES = typeof ACTION_PREFIXES[number];

export const IN_PROGRESS = [
  'CREATE_IN_PROGRESS',
  'REVIEW_IN_PROGRESS',
  'ROLLBACK_IN_PROGRESS',
  'DELETE_IN_PROGRESS',
  'UPDATE_IN_PROGRESS',

  'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS',
  'UPDATE_ROLLBACK_IN_PROGRESS',
  'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS',
  'IMPORT_IN_PROGRESS',
  'IMPORT_ROLLBACK_IN_PROGRESS',
] as const;
export type IN_PROGRESS = typeof IN_PROGRESS[number];

export const COMPLETE  = [
  'CREATE_COMPLETE',
  'ROLLBACK_COMPLETE',
  'DELETE_COMPLETE',
  'UPDATE_COMPLETE',
  'UPDATE_ROLLBACK_COMPLETE',
  'IMPORT_COMPLETE',
  'IMPORT_ROLLBACK_COMPLETE',
] as const;
export type COMPLETE = typeof COMPLETE[number];

export const FAILED = [
  'CREATE_FAILED',
  'DELETE_FAILED',
  'ROLLBACK_FAILED',
  'UPDATE_ROLLBACK_FAILED',
  'IMPORT_ROLLBACK_FAILED'
] as const;
export type FAILED = typeof FAILED[number];

export const SKIPPED = [
  'DELETE_SKIPPED'
] as const;
export type SKIPPED = typeof SKIPPED[number];

export type TERMINAL = COMPLETE | FAILED | SKIPPED | 'REVIEW_IN_PROGRESS';
export const TERMINAL: TERMINAL[] = (COMPLETE as any).concat(FAILED).concat(SKIPPED).concat(['REVIEW_IN_PROGRESS']);
