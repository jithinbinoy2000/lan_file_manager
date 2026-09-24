# Studio Files

A working local file manager with the Studio Admin file-manager layout, a Node.js/TypeScript API, and a React/Vite/Tailwind frontend using **shadcn/ui Base UI** components. Production runs as one Node process.

The interface follows the reference's sidebar, compact header, Roboto typography, monochrome controls, rounded folder cards, file cards, and grid/list layout. File counts, dates, thumbnails, and storage are real data. Navigation is tailored to filesystem locations, rather than linking to unrelated dashboard demos. An additional breadcrumb/navigation row provides actual folder navigation.

## Start

Requirements: Node.js **22.12+** (Node 24 LTS recommended), npm, and ordinary OS access to the files you want to manage.

```sh
npm ci
npm run build
npm start
```

Open the URL printed at startup (default **http://127.0.0.1:3210**). The current workspace has been configured to use **http://127.0.0.1:3211** so the existing browser address opens the real filesystem. `npm start` builds automatically if the production output is missing. After code changes, run `npm run build` again.

```sh
npm run dev          # API :3210 and Vite :5173, both loopback
npm run typecheck
npm test
npm run build
npm start -- --help
npm start -- --port 3220
npm start -- --config /absolute/path/to/config.json
npm run format
```

For development, open **http://127.0.0.1:5173**. Stop an existing production server before starting development on the same port. Production serves both the API and built frontend on :3210; no frontend server is needed.

## Access model and remote machines

The requested initial mode has **no account/password screen**. It is consequently **loopback-only**; `--host 0.0.0.0` and other network bindings are rejected. A random HttpOnly, SameSite session and CSRF token protect API requests, but these are browser-request protections, not user authentication. Other processes/users who can access the host loopback interface are trusted in this version.

Full accessible volume access is on, as requested. The visible **Settings → All volumes** switch can restrict it. No privilege elevation occurs. Encrypted, disconnected, sandboxed, permission-denied, or OS-protected locations remain inaccessible. On macOS, OS privacy permissions granted to your terminal apply to the server. Run under an ordinary user account.

You can run this same Node application on a remote machine and use an **existing authenticated SSH tunnel**, with the application still bound to loopback on that machine:

```sh
# On the remote machine, inside this repository:
npm ci
npm run build
npm start

# On your client computer (requires existing SSH access):
ssh -N -L 3210:127.0.0.1:3210 your-user@your-server
```

Then open http://127.0.0.1:3210 on your client. The app manages the **server's** volumes. If client port 3210 is occupied, use `-L 3220:127.0.0.1:3210` and open :3220. The authentication and encrypted transport are provided by SSH; no SSH service, keys, account, or server was provisioned by this project. This deployment path is documented, not tested against a remote host in this environment.

**Direct LAN access and public internet hosting remain disabled pending the requested authentication/HTTPS decisions.** Do not publish the localhost service through an unauthenticated reverse proxy. Android browser layouts are supported; Android server hosting through Termux remains an open requirement and is not claimed as supported or tested. Android's storage restrictions still apply.

## Configuration

Runtime settings and recoverable trash live **outside the repository**, under `~/.harbor` by default. The name is the application's internal storage namespace. Set `HARBOR_DATA_DIR` before starting to use another private directory. The configuration/trash directory is excluded from filesystem APIs, even when all volumes are enabled.

Copy [config.example.json](config.example.json) outside the repository, or let the Settings screen create `~/.harbor/config.json`:

```json
{
  "host": "127.0.0.1",
  "port": 3210,
  "allVolumes": true,
  "roots": [],
  "maxUploadBytes": 10737418240
}
```

- `host`: `127.0.0.1`, `localhost`, or `::1` only in no-login mode.
- `port`: 1–65535. Prefer an unprivileged port; no automatic elevation.
- `allVolumes`: `true` discovers accessible host volumes, independent of the repository location.
- `roots`: absolute directories enabled when `allVolumes` is false. Examples: `/home/owner/Files`, `/mnt/storage`, or `C:\\Users\\Owner\\Documents` in JSON. Disabling All volumes without configured roots retains the home folder.
- `maxUploadBytes`: per-file limit, default 10 GiB. Uploads are streamed, not buffered in RAM. A whole folder is uploaded as sequential individual files.
- `HARBOR_DATA_DIR`: private application storage; set it using your shell's environment syntax. Files are created with restrictive permissions on POSIX; Windows access control inherits from the user's directory.

The Settings screen persists to the selected configuration file. CLI host and port override file values. Keep active configuration outside the checkout. The example contains no secrets.

## Features

- [x] Discover Windows drive letters, Linux mountinfo roots, macOS `/Volumes`, and the home directory; refresh removable volumes.
- [x] Real folder navigation, browser Back/Forward, Up, and collapsed clickable breadcrumbs.
- [x] Responsive grid/list views, light/dark appearance, file-type icons, bounded image thumbnails.
- [x] Filename search within the current folder; hidden dotfiles; sorting by name, modified time, or size.
- [x] Multi-select, range selection, keyboard navigation, context menus and action menus.
- [x] New folder, file/folder upload, file download and streamed ZIP folder download.
- [x] Rename, copy, cut/move, paste, overwrite confirmation, progress and cancellation.
- [x] Recoverable application trash, restore, and confirmed permanent deletion.
- [x] Image fit/zoom/pan/previous/next; browser-native audio/video controls and seeking.
- [x] HTTP byte ranges, HEAD, ETag conditional requests, Last-Modified, content types and streamed transfers.
- [x] Details and on-demand folder size calculation, with bounded scanning.
- [x] OS permission and missing/disconnected-path error messages, Unicode filenames, symlink containment.

Downloads go to the **browser client**, using that browser's download settings. The server cannot choose an arbitrary path on a remote client.

## Keyboard and selection

| Action                          | Shortcut                                    |
| ------------------------------- | ------------------------------------------- |
| Open                            | Double-click or Enter                       |
| Toggle selection                | Ctrl/Command + click; tap on touch screens  |
| Select range                    | Shift + click                               |
| Select current page             | Ctrl/Command + A                            |
| Copy / cut / paste              | Ctrl/Command + C / X / V                    |
| Rename                          | F2                                          |
| Move to trash                   | Delete; Command + Backspace on macOS        |
| Permanently delete              | Shift + Delete; Shift + Command + Backspace |
| Parent folder                   | Alt + Up                                    |
| Search current folder           | Ctrl/Command + F                            |
| Toggle sidebar                  | Ctrl/Command + B                            |
| Clear selection / close preview | Escape                                      |

All destructive commands require confirmation. Starred filters are per current folder and browser; they are not a global index.

## File safety and practical limits

**Trash:** Harbor trash is application-managed, **not** the OS Recycle Bin/Trash. It stores contents and original locations in the private application directory, and survives restarts. Restore requires the original volume and parent directory to be available. Restore refuses to overwrite another item. There is no automatic expiry or empty-trash control in this version. Trash can consume disk space; choose permanent deletion only when appropriate. An overwrite first moves the old destination to Harbor trash.

**Copy/move:** Same-volume moves use rename. An `EXDEV` cross-volume move uses streamed copying to a staging path, SHA-256 verification, a second tree/content comparison before source removal, and destination commit before source removal. A failed source removal retains the verified destination. Completed items are retained when a batch is cancelled. Active file-copy/upload streams can abort; a single native rename or permanent recursive removal cannot reliably be interrupted halfway through. Do not edit source files in another application while moving them. Pure Node filesystem operations cannot eliminate every race with another local process; this is not a sandbox for hostile local users. ACLs, extended attributes, resource forks, hard-link identity, and alternate data streams are not preserved by copied files.

**Links:** Listings identify symbolic links. Reading/navigating a link is allowed only when its resolved destination stays within its selected enabled root. A link outside that root must be opened through another enabled volume. Rename/trash/delete act on the link entry itself. Recursive copy/move/ZIP operations containing links or special files are refused rather than silently following them. Protected application storage and selected root entries cannot be mutated.

**Large directories:** Server listings are capped at 50,000 entries, globally sorted, and returned in pages of 200. Only one page is rendered at a time; errors explicitly explain the cap. The directory snapshot cache is bounded (8 folders, 15 seconds). Recursive operations/size scans stop at 100,000 entries. Search is not a recursive full-disk index. Folder counts and recursive sizes are not precomputed for every card, to avoid expensive disk scans.

**Resource use:** File transfers use streaming/backpressure. One mutation runs at a time to avoid conflicting app operations. Upload limit defaults to 10 GiB per file; request timeout is 30 minutes. Thumbnail decoding runs two workers with a bounded queue, accepts up to 40 million input pixels / 80 MiB files, and produces small WebP images. Previewing the full original image still uses browser memory. Folder upload does not preserve empty directories. Drag/drop is for files; use Upload folder for directory trees.

**Media:** Files are streamed directly; seeking uses Range requests and playback uses the browser's native decoder. No transcoding was requested or installed. Codec support, disk speed, Wi-Fi, and the client device determine playback performance; zero lag cannot be guaranteed. Unsupported codecs show a fallback with download. HTML, SVG and other active/unpreviewable content are sent as attachments, never trusted as application pages.

**Recovery:** Operation jobs are in-memory and do not resume after process restart. A hard crash may leave `.harbor-part-*` staging files; they are hidden from normal app listings. Review their contents and remove them manually only after confirming the originals are intact. Do not run two server instances against the same data directory/filesystem concurrently.

## Structure

```text
.
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── app.ts          # API, sessions/CSRF, streaming, uploads, static frontend
│   │   │   ├── config.ts       # Validated config and CLI
│   │   │   ├── index.ts        # Single production server
│   │   │   ├── jobs.ts         # Cancellable operation progress
│   │   │   ├── operations.ts   # Verified transfers and recoverable trash
│   │   │   ├── paths.ts        # Central path/permission boundary
│   │   │   ├── shortcuts.ts    # Existing, authorized home-directory shortcuts
│   │   │   └── volumes.ts      # Platform volume discovery
│   │   ├── test/server.test.ts
│   │   └── tsconfig.json
│   └── web/
│       ├── index.html
│       └── src/
│           ├── App.tsx
│           ├── main.tsx
│           ├── styles.css
│           ├── components/    # File cards, media preview, shadcn Base UI wrappers
│           ├── hooks/
│           └── lib/           # Typed API client
├── packages/shared/types.ts
├── scripts/check-build.mjs
├── config.example.json
├── components.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
└── THIRD_PARTY_NOTICES.md
```

A single root package/lockfile manages both apps and shared types; separate package manifests would add no useful publishing boundary here. Dependencies are pinned. No user files, runtime config, secrets, node_modules, build output, or browser test artifacts are tracked.

## Verification

See [VERIFICATION.md](VERIFICATION.md) for the tested commands, browser checks, and platform limitations. Automated tests use temporary directories and do not modify user files. Cross-volume `EXDEV` behavior is simulated; a physical second-volume test is still required on each supported OS.

## Reference and component sources

- [Studio Admin file-manager reference](https://studio-admin.arhamkhnz.com/dashboard/file-manager), also inspected in the owner's local Skiladiz checkout. Layout adaptation credit and MIT terms are retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [shadcn Base UI Breadcrumb](https://ui.shadcn.com/docs/components/base/breadcrumb), [Sidebar](https://ui.shadcn.com/docs/components/base/sidebar), and [Vite installation](https://ui.shadcn.com/docs/installation/vite). Components were installed with the `base-nova` preset and verified to import `@base-ui/react`.
- [Node filesystem API](https://nodejs.org/api/fs.html), [Express API](https://expressjs.com/en/5x/api/), and [Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/).
