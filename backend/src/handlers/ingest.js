import { runIngest } from '../lib/ingest.js';
import { getRepo } from '../repo/index.js';

/** EventBridge schedule target — refreshes the H3 PM2.5 tiles. */
export const handler = async () => {
  const summary = await runIngest({ repo: await getRepo() });
  console.log(JSON.stringify(summary));
  return summary;
};
