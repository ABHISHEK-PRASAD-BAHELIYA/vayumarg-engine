let current = null;

/** Lazily creates the DynamoDB repo (cached across warm Lambda invocations). */
export async function getRepo() {
  if (!current) {
    const { DynamoRepo } = await import('./dynamo.js');
    current = new DynamoRepo(process.env.TABLE_NAME);
  }
  return current;
}

/** Swap the repo (local dev server and tests). */
export function setRepo(repo) {
  current = repo;
}
