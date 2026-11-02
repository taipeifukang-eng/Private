export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/workspace/" + path, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      signal: options.signal || AbortSignal.timeout(30000),
    });
  } catch {
    throw new ApiError(0, "連線中斷或逾時，內容仍保留，請稍後重試");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "login")
      window.dispatchEvent(new Event("workspace-session-expired"));
    throw new ApiError(
      response.status,
      [data.error || "服務暫時無法使用，請重試", ...(Array.isArray(data.errors) ? data.errors : [])].join("\n"),
    );
  }
  return data as T;
}
export type Store = {
  id: string;
  store_code: string;
  store_name: string;
  short_name?: string;
};
export type Campaign = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  campaign_type: "promotion" | "inventory";
  is_active: boolean;
  workspace_version: number;
  updated_at: string;
};
export const taiwanMonth = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
