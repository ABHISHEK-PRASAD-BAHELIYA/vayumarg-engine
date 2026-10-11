import { TILE_TTL_SECONDS } from '../lib/config.js';

/** In-memory tile store with the same interface as the DynamoDB repo (local dev + tests). */
export class MemoryRepo {
  constructor() {
    this.items = new Map();
  }

  async getCells(cells, nowSec = Math.floor(Date.now() / 1000)) {
    const out = new Map();
    for (const cell of cells) {
      const item = this.items.get(cell);
      if (item && item.ttl > nowSec) out.set(cell, item);
    }
    return out;
  }

  async putCells(items) {
    for (const item of items) this.items.set(item.cell, item);
  }

  /** Test helper. */
  seed(cell, pm25, { source = 'test', nowSec = Math.floor(Date.now() / 1000) } = {}) {
    this.items.set(cell, { cell, pm25, source, updatedAt: nowSec, ttl: nowSec + TILE_TTL_SECONDS });
  }
}
