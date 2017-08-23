function debug(): boolean {
  return typeof process.env.DEBUG === 'string' || process.env.LOG_LEVEL === 'DEBUG';
}
export default debug;
