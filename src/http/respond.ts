import { AppError, isAppError, publicMessage } from "../contracts/errors.ts";

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-API-Key",
  "access-control-max-age": "86400",
};

export function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) response.headers.set(key, value);
  return response;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...headers,
      },
    }),
  );
}

export function html(body: string, status = 200): Response {
  return withCors(
    new Response(body, {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
    }),
  );
}

export function svg(body: string): Response {
  return withCors(
    new Response(body, {
      status: 200,
      headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
    }),
  );
}

export function redirect(location: string): Response {
  return withCors(new Response(null, { status: 302, headers: { location } }));
}

export function preflight(): Response {
  return withCors(new Response(null, { status: 204 }));
}

export function errorResponse(error: unknown, log = console.error): Response {
  const appError = isAppError(error) ? error : new AppError("internal", error instanceof Error ? error.message : String(error));
  if (!isAppError(error)) log("[http] unexpected error", error);
  else if (appError.detail) log(`[http] ${appError.code}: ${appError.detail}`);

  return json(
    {
      error: {
        code: appError.code,
        message: appError.publicMessage ?? publicMessage("internal"),
      },
    },
    appError.status,
  );
}
