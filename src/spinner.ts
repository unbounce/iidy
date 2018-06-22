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

export default function (): Spinner {
  const tty: any = process.stdout; // tslint:disable-line
  return ora({
    spinner: 'dots12',
    text: '',
    enabled: _.isNumber(tty.columns)
  });
}
