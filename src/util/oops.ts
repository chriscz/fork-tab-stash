import {shallowReactive} from "vue";

export type LoggedError = {
  summary: string;
  details: string;
  error: unknown;
};

/** The maximum size of the error log. */
export const ERROR_LOG_SIZE = 10;

/** The error log itself, which is reactive (even though its elements aren't). */
export const errorLog = shallowReactive([] as LoggedError[]);
(<any>globalThis).error_log = errorLog;

/** Calls the async function and returns its result.  If the function throws an
 * exception, the exception is logged and re-thrown to the caller.  The logs can
 * later be read by other code. */
export async function logErrorsFrom<R>(f: () => Promise<R>): Promise<R> {
  try {
    return await f();
  } catch (e) {
    logError(e);
    throw e;
  }
}

/** Add an error to the log. */
export function logError(error: unknown) {
  // The stack is logged as text too, because Chrome's extension Errors page
  // keeps only the text of what was logged and the logger's own frame, which
  // would otherwise lose where the error was raised.
  if (error instanceof Error && error.stack) {
    console.error(error, "\n" + error.stack);
  } else {
    console.error(error);
  }

  if (error instanceof Error) {
    errorLog.push({
      error,
      summary: error.message,
      details: error.stack || error.message,
    });
  } else if (typeof error === "object") {
    const obj: any = error;
    errorLog.push({
      error,
      summary: String(error),
      details:
        "stack" in obj && typeof obj.stack === "string"
          ? obj.stack
          : String(error),
    });
  } else {
    errorLog.push({error, summary: String(error), details: String(error)});
  }

  while (errorLog.length > ERROR_LOG_SIZE) errorLog.shift();
}

/** Clears the error log (usually done at the request of the user). */
export function clearErrorLog() {
  errorLog.splice(0, errorLog.length);
}

/** An error that's actually the user's fault. */
export class UserError extends Error {}
