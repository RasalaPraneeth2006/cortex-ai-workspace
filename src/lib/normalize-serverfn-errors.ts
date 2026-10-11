import { createMiddleware } from "@tanstack/react-start";

/**
 * Client-side functionMiddleware that catches raw `Response` objects thrown
 * by server functions (e.g. auth middleware `throw new Response('Unauthorized', ...)`)
 * and converts them into structured `Error` instances the UI can render.
 *
 * Without this, TanStack surfaces the raw Response as `Error: [object Response]`
 * and the router error boundary shows a blank screen with no useful message.
 */
export type NormalizedServerFnError = Error & {
  status?: number;
  code?: string;
  isServerFnError: true;
};

function makeError(message: string, status?: number, code?: string): NormalizedServerFnError {
  const err = new Error(message) as NormalizedServerFnError;
  err.name = "ServerFnError";
  err.status = status;
  err.code = code;
  err.isServerFnError = true;
  return err;
}

async function responseToError(res: Response): Promise<NormalizedServerFnError> {
  const status = res.status;
  let bodyText = "";
  try {
    bodyText = await res.clone().text();
  } catch {
    /* ignore */
  }
  let message = bodyText?.trim() || res.statusText || `Request failed (${status})`;
  let code: string | undefined;
  if (bodyText) {
    try {
      const j = JSON.parse(bodyText);
      if (j && typeof j === "object") {
        message = j.message || j.error || message;
        code = j.code;
      }
    } catch {
      /* not JSON, keep text */
    }
  }
  if (status === 401) {
    code = code ?? "UNAUTHORIZED";
    message = "You need to sign in to continue.";
  } else if (status === 403) {
    code = code ?? "FORBIDDEN";
    message = message || "You don't have access to this resource.";
  } else if (status === 429) {
    code = code ?? "RATE_LIMITED";
    message = "Too many requests. Please wait and try again.";
  } else if (status === 402) {
    code = code ?? "PAYMENT_REQUIRED";
    message = "AI credits exhausted. Add credits to continue.";
  } else if (status >= 500) {
    code = code ?? "SERVER_ERROR";
    message = message || "Something went wrong on the server.";
  }
  return makeError(message, status, code);
}

export const normalizeServerFnErrors = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    try {
      return await next();
    } catch (err: unknown) {
      if (err instanceof Response) {
        throw await responseToError(err);
      }
      if (err && typeof err === "object" && "message" in err) {
        const msg = String((err as { message: unknown }).message ?? "");
        if (msg === "[object Response]") {
          throw makeError("Request failed. Please try again.", undefined, "UNKNOWN");
        }
      }
      throw err;
    }
  },
);