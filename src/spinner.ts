import * as process from 'process';
import * as _ from 'lodash';
import * as ora from 'ora';

// NOTE: @types/ora doesn't export the Ora class
// export a limited version of what Ora supports
export interface Spinner {
    start(text?: string): Spinner;
    stop(): Spinner;
    succeed(text?: string): Spinner;
    fail(text?: string): Spinner;
    warn(text?: string): Spinner;
    info(text?: string): Spinner;
    clear(): Spinner;
    text: string;
}

const INCOMPATIBLE_TERMS = ['eterm', 'eterm-color'];

export function spinnerSupported() {
  const tty: any = process.stdout; // tslint:disable-line
  return _.isNumber(tty.columns) && ! _.includes(INCOMPATIBLE_TERMS, process.env.TERM)
}

export default function (text: string=''): Spinner {
  return ora({
    spinner: 'dots12',
    text,
    enabled: spinnerSupported()
  });
}
