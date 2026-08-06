/**
 * Errors the routes turn straight into responses. Each one carries the status
 * it deserves, so handlers stay free of status-code bookkeeping.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string) =>
  new HttpError(404, 'not_found', `${what} not found`);

export const stallClosed = () =>
  new HttpError(423, 'stall_closed', 'This stall is not taking orders yet');

export const unauthorized = () =>
  new HttpError(401, 'unauthorized', 'Sign in to the stall first');

/** Items that sold out between page load and submit, named so the UI can say so. */
export const itemsUnavailable = (
  items: Array<{ id: string; name: string }>,
) =>
  new HttpError(
    409,
    'items_unavailable',
    items.length === 1
      ? `${items[0]?.name} just sold out`
      : `${items.length} items just sold out`,
    { items },
  );
