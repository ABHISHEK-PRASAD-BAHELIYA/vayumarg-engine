import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const BATCH_GET_MAX = 100;
const BATCH_WRITE_MAX = 25;
const MAX_RETRIES = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
// Full-jitter exponential backoff for throttled / unprocessed batches.
const backoff = (attempt) => sleep(Math.random() * Math.min(1000, 50 * 2 ** attempt));

/**
 * DynamoDB-backed tile store. One item per H3 cell:
 *   { cell (PK), pm25, n, source, updatedAt (epoch s), ttl (epoch s) }
 */
export class DynamoRepo {
  constructor(tableName, client = DynamoDBDocumentClient.from(new DynamoDBClient({}))) {
    if (!tableName) throw new Error('TABLE_NAME is not set');
    this.table = tableName;
    this.client = client;
  }

  async getCells(cells, nowSec = Math.floor(Date.now() / 1000)) {
    const out = new Map();
    const unique = [...new Set(cells)];
    await Promise.all(
      chunk(unique, BATCH_GET_MAX).map(async (keys) => {
        let pending = { [this.table]: { Keys: keys.map((cell) => ({ cell })) } };
        for (let attempt = 0; pending && attempt <= MAX_RETRIES; attempt++) {
          if (attempt > 0) await backoff(attempt);
          const res = await this.client.send(new BatchGetCommand({ RequestItems: pending }));
          for (const item of res.Responses?.[this.table] ?? []) {
            // DynamoDB TTL deletion can lag by up to ~48 h, so filter expired items ourselves.
            if (item.ttl > nowSec) out.set(item.cell, item);
          }
          const left = res.UnprocessedKeys;
          pending = left && Object.keys(left).length ? left : null;
        }
        if (pending) throw new Error('DynamoDB BatchGet kept returning unprocessed keys');
      }),
    );
    return out;
  }

  async putCells(items) {
    for (const batch of chunk(items, BATCH_WRITE_MAX)) {
      let pending = { [this.table]: batch.map((Item) => ({ PutRequest: { Item } })) };
      for (let attempt = 0; pending && attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) await backoff(attempt);
        const res = await this.client.send(new BatchWriteCommand({ RequestItems: pending }));
        const left = res.UnprocessedItems;
        pending = left && Object.keys(left).length ? left : null;
      }
      if (pending) throw new Error('DynamoDB BatchWrite kept returning unprocessed items');
    }
  }
}
