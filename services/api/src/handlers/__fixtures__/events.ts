// Eventos de API Gateway HTTP API (payload 2.0) para los tests unitarios de los handlers.
import type { HttpEvent } from "../http.ts";

export interface EventOptions {
  routeKey: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: unknown;
  claims?: Record<string, string | number | boolean | string[]>;
}

export const USER_CLAIMS = { sub: "user-1", email: "user@example.com", token_use: "id" };
export const ADMIN_CLAIMS = { ...USER_CLAIMS, sub: "admin-1", email: "admin@example.com", "cognito:groups": "[admin]" };

export function httpEvent(opts: EventOptions): HttpEvent {
  const [method, rawPath] = opts.routeKey.split(" ");
  return {
    version: "2.0",
    routeKey: opts.routeKey,
    rawPath: rawPath ?? "/",
    rawQueryString: new URLSearchParams(opts.queryStringParameters ?? {}).toString(),
    headers: {},
    ...(opts.pathParameters ? { pathParameters: opts.pathParameters } : {}),
    ...(opts.queryStringParameters ? { queryStringParameters: opts.queryStringParameters } : {}),
    ...(opts.body !== undefined ? { body: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body) } : {}),
    isBase64Encoded: false,
    requestContext: {
      accountId: "000000000000",
      apiId: "api",
      domainName: "localhost",
      domainPrefix: "api",
      http: {
        method: method ?? "GET",
        path: rawPath ?? "/",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "req-1",
      routeKey: opts.routeKey,
      stage: "$default",
      time: "",
      timeEpoch: 0,
      authorizer: { principalId: "", integrationLatency: 0, jwt: { claims: opts.claims ?? USER_CLAIMS, scopes: [] } },
    },
  } as HttpEvent;
}

export function bodyOf(result: { body?: string | undefined }): unknown {
  return JSON.parse(result.body ?? "null");
}
