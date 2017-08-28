function debug(): boolean {
  return process.env.LOG_LEVEL === 'DEBUG' || process.env.DEBUG !== undefined;
}
export default debug;
