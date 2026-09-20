export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code?: string) => new HttpError(400, message, code);
export const unauthorized = (message = "Please sign in to continue.") =>
  new HttpError(401, message, "UNAUTHORIZED");
export const forbidden = (message = "You don't have access to this.") =>
  new HttpError(403, message, "FORBIDDEN");
export const notFound = (message = "Not found.") => new HttpError(404, message, "NOT_FOUND");
export const conflict = (message: string, code?: string) => new HttpError(409, message, code);
