import * as process from 'process';

export const writeRaw = (s: string) => process.stdout.write(s);
export const writeLine = (...args: any) => console.log(...args);

export const writeErrorRaw = (s: string) => process.stderr.write(s);
export const writeErrorLine = (s: string) => console.error(s);
