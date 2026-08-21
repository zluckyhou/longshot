# Privacy Policy — Longshot (Scrolling Screenshot)

**Last updated: 21 August 2026**

## Short version

Longshot does not collect, transmit, or sell any data. Every screenshot is
captured, stitched, edited and exported entirely inside your own browser. The
extension has no server, no account system, and no analytics.

## What Longshot does *not* do

- It does not collect personal information of any kind.
- It does not send your screenshots, page contents, URLs, or browsing history
  anywhere. Nothing is uploaded — there is no endpoint to upload to.
- It contains no analytics, telemetry, tracking pixels, advertising, or
  third-party SDKs.
- It does not require an account, a licence key, or a sign-in.
- It does not sell or share data with third parties, because it holds none.

## What stays on your device

**Your captured images.** When you capture a page, the image data lives in your
browser's memory while the extension stitches it together, and is then handed
to you in one of two ways you choose: saved as a file through Chrome's own
download mechanism, or copied to your system clipboard. Longshot keeps no copy
afterwards.

**Your settings.** Longshot stores your own preferences using
`chrome.storage.local` — image format (PNG/JPG), JPEG quality, the per-screen
wait time, the three capture options, and what should happen after a capture.
The editor additionally records one flag in `localStorage` marking that a
first-run hint has been shown. All of this is stored locally on your computer,
is never transmitted, and is deleted when you remove the extension.

## Permissions, and why each one is needed

| Permission | Why Longshot needs it |
|---|---|
| `activeTab` | To read the page you are currently looking at, only at the moment you click the Longshot button or press its shortcut. Longshot has no standing access to any site. |
| `scripting` | To run the measuring-and-scrolling routine inside that one tab so the page can be captured screen by screen. |
| `downloads` | To save the finished image to your computer when you ask it to. |
| `storage` | To remember your own settings between sessions, as described above. |
| `offscreen` | To stitch the captured screens into one tall image in a background document, since a service worker cannot use a canvas. |
| `clipboardWrite` | To copy the finished image to your clipboard when you press Copy. |

Longshot declares **no host permissions** and installs **no persistent content
script**. It touches a page only on the tab you explicitly invoke it on, and
only for the duration of that capture.

## Children

Longshot is a general-purpose utility. It collects no data from anyone,
including children.

## Changes to this policy

If this policy changes, the updated version will be published at this same
address with a new date at the top. Because the extension collects nothing, any
future change that introduced data collection would be announced in the
extension's release notes as well.

## Contact

Questions about this policy: please open an issue at
<https://github.com/zluckyhou/longshot/issues>.
