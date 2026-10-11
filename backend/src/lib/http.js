export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

/** Wraps a handler body so thrown HttpErrors become clean JSON responses. */
export const respond = async (fn) => {
  try {
    return json(200, await fn());
  } catch (err) {
    if (err instanceof HttpError) return json(err.statusCode, { error: err.message });
    console.error('Unhandled error', err);
    return json(500, { error: 'Internal server error' });
  }
};
