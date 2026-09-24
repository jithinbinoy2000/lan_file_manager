export interface Volume {
  id: string;
  name: string;
  path: string;
  kind: "home" | "volume";
  total?: number;
  free?: number;
}
export interface Entry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  size: number;
  modified: number;
  mime: string;
  hidden: boolean;
}
export interface Listing {
  entries: Entry[];
  total: number;
  next: number | null;
  root: Volume;
  path: string;
}
export interface Location {
  root: string;
  path: string;
}
export interface Job {
  id: string;
  type: string;
  status: "running" | "done" | "error" | "cancelled";
  completed: number;
  total: number;
  bytes: number;
  message: string;
  error?: string;
  result?: unknown;
}
export interface TrashItem {
  id: string;
  name: string;
  deletedAt: number;
  root: string;
  path: string;
}
export interface Shortcut extends Location {
  id: "home" | "downloads" | "documents" | "pictures" | "videos" | "music";
  name: string;
}
export interface VolumeResponse {
  volumes: Volume[];
  shortcuts: Shortcut[];
  allVolumes: boolean;
  platform: string;
}
