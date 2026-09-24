import type { Location } from "../../../../packages/shared/types";
let csrf = "";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || "Request failed.", response.status);
  if (response.status === 202) window.dispatchEvent(new Event("studio-operation"));
  return data;
}
export class LoginRequiredError extends Error {}
export async function session() {
  const response = await fetch("/api/session");
  const data = await response.json();
  if (response.status === 401 && data.loginRequired) throw new LoginRequiredError();
  if (!response.ok) throw new ApiError(data.error || "Request failed.", response.status);
  csrf = data.csrf;
  return data as { csrf: string; allVolumes: boolean; maxUploadBytes: number };
}
export async function login(password: string) {
  const s = await api<{ csrf: string; allVolumes: boolean; maxUploadBytes: number }>("/session", {
    password,
  });
  csrf = s.csrf;
  return s;
}
export const query = (loc: Location) => new URLSearchParams({ root: loc.root, path: loc.path }).toString();
export function url(loc: Location, kind = "file", download = false) {
  return `/api/${kind}?${query(loc)}${download ? "&download=true" : ""}`;
}
export const bytes = (n: number) => {
  if (!n) return "0 B";
  const unit = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
};
export const date = (n: number) =>
  new Date(n).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(n).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
export function upload(
  file: File,
  loc: Location,
  onProgress: (value: number) => void,
  signal: AbortSignal,
  overwrite = false,
  relativePath?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/upload?${query(loc)}&overwrite=${overwrite}`);
    xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.upload.onprogress = (e) => onProgress(e.lengthComputable ? (e.loaded / e.total) * 100 : 0);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = "Upload failed.";
        try {
          message = JSON.parse(xhr.responseText).error;
        } catch {}
        reject(new ApiError(message, xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error("Connection lost during upload."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append("file", file, relativePath || file.name);
    xhr.send(form);
  });
}
