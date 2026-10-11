// Zero-dependency local API (no Docker, no AWS) that runs the SAME handlers
// against an in-memory tile store seeded by the ingest pipeline.
import { createServer } from 'node:http';
import { MemoryRepo } from '../repo/memory.js';
import { setRepo } from '../repo/index.js';
import { runIngest } from '../lib/ingest.js';
import { handler as score } from '../handlers/score.js';
import { handler as air } from '../handlers/air.js';

const PORT = Number(process.env.PORT ?? 3001);
const repo = new MemoryRepo();
setRepo(repo);

const seed = async () => {
  const summary = await runIngest({ repo });
  console.log(`[ingest] source=${summary.source} cells=${summary.cellsWritten}`);
};
await seed();
setInterval(() => seed().catch(console.error), 30 * 60 * 1000).unref();

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const event = {
    body: Buffer.concat(chunks).toString('utf8'),
    isBase64Encoded: false,
    queryStringParameters: Object.fromEntries(url.searchParams),
  };

  let out;
  if (req.method === 'POST' && url.pathname === '/score') out = await score(event);
  else if (req.method === 'GET' && url.pathname === '/air') out = await air(event);
  else out = { statusCode: 404, headers: { 'content-type': 'application/json' }, body: '{"error":"Not found"}' };

  res.writeHead(out.statusCode, { ...out.headers, ...cors }).end(out.body);
}).listen(PORT, () => console.log(`VayuMarg local API on http://localhost:${PORT}  (POST /score, GET /air)`));
