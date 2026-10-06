/** An error with an HTTP status, raised by the operations layer and mapped by REST and MCP. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, message, details)
export const notFound = (message: string) => new ApiError(404, message)
export const conflict = (message: string) => new ApiError(409, message)
