import getReliableTime from '../getReliableTime';

async function getReliableStartTime(): Promise<Date> {
  const startTime = await getReliableTime();
  startTime.setTime(startTime.getTime() - 500); // to be safe
  // TODO warn about inaccurate local clocks as that will affect the calculation of elapsed time.
  return startTime;
}

export default getReliableStartTime;
