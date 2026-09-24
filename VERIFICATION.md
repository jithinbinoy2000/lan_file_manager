# Verification record

Environment: macOS, Node.js 24.12.0, npm 11.6.2, Chromium through Playwright. Test data is isolated in temporary folders; no existing user files were mutated.

## Automated checks

- `npm run typecheck` — passed.
- `npm test` — 20 tests passed.
- `npm run build` — passed; server JavaScript and production web assets emitted.
- `npm start -- --help` — passed; host, port, configuration and no-login restrictions printed.
- `npm run dev` — API and Vite launched; web page and proxied session endpoint both returned HTTP 200. Both development processes then stopped normally.
- `npm start` — production server launched at `http://127.0.0.1:3211`, with full accessible volumes and no-login loopback mode.
- npm dependency audit during install — no known vulnerabilities reported at that time. This is not a security audit of application code.

The automated suite covers:

1. Path containment, portable filename validation, Unicode and escaped Linux mounts.
2. Discovery of accessible configured directory roots.
3. Session requirement, CSRF rejection, malicious Origin and Host rejection.
4. Rejection of network binding in no-login mode.
5. Hidden-file and filename filtering.
6. Traversal, external symlinks and private-data aliases.
7. HTTP partial/suffix/open ranges, HEAD, ETag/304, invalid/multipart ranges and 416.
8. HTML attachment handling and sanitized missing-file errors.
9. Folder creation, rename, copy, conflicts, overwrite, move, trash, restore and permanent deletion.
10. Streaming upload, conflict preservation, oversized-file rejection and cleanup.
11. Image thumbnail generation and streamed ZIP output.
12. Verified copy and pre-aborted transfer cancellation.
13. Read/mutation enforcement for selected roots.
14. Cross-volume move fallback with a simulated `EXDEV` rename failure.
15. Detection of mismatched source contents before removal.
16. Multiple-file multipart rejection and staging cleanup.
17. Pagination of a 215-entry folder and missing-job cancellation errors.
18. Copy of a read-only directory/file, preserving contents and POSIX permissions.
19. Shortcut discovery does not append Downloads to an unrelated configured root.
20. Volume API exposes only verified shortcuts within the permitted roots.

## Browser checks

- Created `UI verification` using the actual New folder dialog and Enter submission; success toast and real directory confirmed.
- Double-clicked into that directory and confirmed its empty state and breadcrumb.
- Loaded a generated 960 × 640 PNG through the preview API; checked successful image decode and Zoom in changing the image to `scale(1.25)`.
- Generated a three-second VP8 WebM test clip and uploaded it through the application's authenticated/CSRF-protected upload API.
- Opened the WebM in the actual video preview, played it, paused it, and sought to one second. Confirmed `readyState: 4`, `currentTime: 1`, `videoWidth: 320`, `error: null`.
- Initial visual checks caught and fixed a grid shift that interfered with double-click and a CSP/font bundling mismatch.

Screenshots and additional responsive checks are stored under the ignored `output/playwright/` directory. Initial media checks used synthetic fixtures; later layout checks used real directory listings without modifying their files.

## Platform and scope limits

- macOS is the only live host tested here.
- Windows drive discovery and Linux mount parsing are implemented; their live OS behavior, OS permissions, removable drives, long paths, and packaging still require tests on physical or virtual Windows/Ubuntu hosts.
- `EXDEV` is simulated, not tested against two physical volumes. Sudden power loss and physical drive disconnects were not simulated.
- Mobile layouts are browser-viewport checks, not physical Android device tests. Android/Termux server hosting remains undecided and unverified.
- No account/login implementation, direct LAN exposure, HTTPS reverse proxy, public deployment or remote SSH connection was tested or provisioned. Loopback-only mode is intentional until the access-model decisions are supplied.
- Tested media does not prove support for every codec or a zero-lag guarantee. Unsupported codecs remain downloadable; no transcoding.
- These checks are not a penetration test. The application assumes the local machine and local users/processes are trusted.

## Correction of the test-instance exposure

The initial browser verification used a restricted temporary root on port 3211. The owner encountered that test instance and its incorrect hardcoded Downloads shortcut. Both old server instances were stopped; port 3211 now runs the real application with all accessible volumes. Sidebar shortcuts are discovered and checked by the backend, old root IDs recover to the real workspace, and idle job polling backs off to 30 seconds. Live API checks returned HTTP 200 for Home (12 items), Downloads (12), Documents (4), Pictures (2), Movies (1), and Music (1) at the time of verification. These counts can change.

The corrected Downloads shortcut was also clicked in Chromium: it showed the real Downloads location and 12 rendered entries without an error state. Browser Back returned to Home. Light desktop (1374 × 854), dark desktop and dark mobile (390 × 844) screenshots were captured and visually inspected. A real Downloads file's metadata and download HEAD endpoints both returned HTTP 200 with the expected file size, without reading its contents. Only the real server on port 3211 remains running; the test server was stopped.

## List and mobile layout correction — September 24, 2026

- Compared the local Skiladiz file manager's folder grid and file list components. Folders now remain cards when the file display switches to list, matching that reference.
- Fixed the shared folder/list class conflict that caused vertically stacked list rows. File rows now align names, metadata and actions in a responsive CSS grid.
- Verified real Downloads in light desktop list view (1374 × 854), dark phone list view (390 × 844), and narrow phone list/grid views (320 × 800). Inspected saved screenshots visually. Desktop file rows measured 56 pixels high and the folder card measured 98 pixels.
- Checked a deeper source-directory breadcrumb and list layout at widths 320, 390, 640, 768, 1024 and 1374 pixels. Document width equaled viewport width at every breakpoint; metadata columns hide progressively and action buttons remain visible.
- Verified one-column phone folder/file grids, the mobile sidebar opening and closing after navigation, and the file action menu opening by mouse click and displaying Details. Removed trigger-level click propagation suppression that interfered with the menu; row selection now ignores clicks on buttons and menu items.
- Browser console reported no errors or warnings. Typecheck, formatting check and production build passed after the fixes. These are Chromium viewport checks, not physical phone tests.
