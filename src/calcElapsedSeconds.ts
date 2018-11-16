const calcElapsedSeconds = (since: Date) => Math.ceil((+(new Date()) - +(since)) / 1000);
export default calcElapsedSeconds;
