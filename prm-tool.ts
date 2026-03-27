import { z } from "zod";

const methodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const inputSchema = z.object({
  method: methodSchema.default("GET"),
  path: z.string(),
  query: z.record(z.string()).optional(),
  body: z.unknown().optional(),
});

type Input = z.infer<typeof inputSchema>;

type RequestOptions = {
  baseUrl?: string;
  apiKey?: string;
  bearerToken?: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function buildAuthorizationHeader(apiKey?: string, bearerToken?: string): string {
  if (bearerToken) {
    return bearerToken.startsWith("Bearer ") ? bearerToken : `Bearer ${bearerToken}`;
  }
  if (apiKey) {
    return apiKey;
  }
  return requireEnv("PRM_API_KEY");
}

function normalizeBaseUrl(base: string): string {
  let url = base.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }
  return url.replace(/\/$/, "");
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    throw new Error("path must be relative, not a full URL");
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function applyQuery(url: URL, query: Record<string, string> | undefined) {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
}

export async function prmRequest(input: Input, options: RequestOptions = {}) {
  const data = inputSchema.parse(input);
  const baseUrl = normalizeBaseUrl(
    options.baseUrl || process.env.PRM_BASE_URL || "https://core-api-gw.uid.alpha.ui.com"
  );
  const apiKey = options.apiKey || process.env.PRM_API_KEY;
  const bearerToken = options.bearerToken || process.env.PRM_BEARER_TOKEN;
  const authorization = buildAuthorizationHeader(apiKey, bearerToken);

  const url = new URL(`${baseUrl}${normalizePath(data.path)}`);
  applyQuery(url, data.query);

  const headers: Record<string, string> = {
    Authorization: authorization,
    accept: "application/json",
  };
  if (data.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(url.toString(), {
    method: data.method,
    headers,
    body: data.body !== undefined ? JSON.stringify(data.body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await res.json().catch(() => ({}))
    : await res.text();

  if (!res.ok) {
    const msg =
      typeof payload === "object" && payload
        ? (payload as any).msg || (payload as any).code || "unknown"
        : String(payload || "unknown");
    const err = new Error(`API error ${res.status}: ${msg}`);
    (err as any).status = res.status;
    throw err;
  }

  return payload;
}
