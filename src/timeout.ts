export const timeout = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));
export default timeout;
