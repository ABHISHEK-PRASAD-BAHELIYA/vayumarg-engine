import { respond, HttpError } from '../lib/http.js';
import { scoreRoutes } from '../lib/scoring.js';
import { getRepo } from '../repo/index.js';

/** POST /score — scores candidate route polylines against live H3 PM2.5 tiles. */
export const handler = async (event) =>
  respond(async () => {
    let body;
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body;
      body = JSON.parse(raw ?? '');
    } catch {
      throw new HttpError(400, 'Request body must be valid JSON');
    }
    return scoreRoutes(body, await getRepo());
  });
