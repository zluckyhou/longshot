<div align="center">

<img src="https://raw.githubusercontent.com/zluckyhou/longshot/main/icon.png" width="88" alt="">

# Longshot — Scrolling Screenshot

**One click, the whole page.** A Chrome extension that captures a full-page
scrolling screenshot, then lets you crop, annotate and copy it — without a
single byte leaving your browser.

[Privacy policy](PRIVACY.md) · [隐私政策](PRIVACY.zh-CN.md) · [Report a bug](https://github.com/zluckyhou/longshot/issues/new?template=bug_report.yml) · [Request a feature](https://github.com/zluckyhou/longshot/issues/new?template=feature_request.yml)

</div>

---

## What it does

**Full-page capture.** Longshot scrolls the page for you, captures it screen by
screen, and stitches the result into one tall image at the page's real
resolution.

**Handles the pages that usually break scrolling screenshots.** Fixed headers
are kept off every screen but the first. Sticky elements are put back where
they belong in the document. Lazy-loaded images are pre-scrolled so nothing
arrives blank.

**A real editor, not a preview.** Crop to the part that matters; draw arrows,
boxes, ellipses and freehand marks; add text; pixelate anything private; and
drop in a magnifier loupe that enlarges a detail in place so it stays readable
at a glance.

**Export the way you want it.** Set the output size, save as PNG or JPG, or
copy the finished image straight to the clipboard.

## Shortcuts

| | |
|---|---|
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | Capture the full page |

In the editor:

| Key | Tool | | Key | Action |
|---|---|---|---|---|
| `V` | Select / move / resize | | `C` or `⌘C` | Copy image to clipboard |
| `X` | Crop | | `⌘S` | Save PNG |
| `P` | Draw | | `⌘Z` / `⌘⇧Z` | Undo / redo |
| `A` | Arrow | | `Delete` | Delete selection |
| `R` | Rectangle | | `Esc` | Deselect, then back to Select |
| `O` | Ellipse | | `⌘0` | Fit to window |
| `M` | Magnifier | | `Space`+drag | Pan the canvas |
| `B` | Mask (pixelate) | | `Shift`+draw | Constrain to a square/circle |
| `T` | Text | | `⌘`+wheel | Zoom |

## Privacy

Nothing is uploaded. There is no server, no account and no analytics — capture,
stitching, editing and export all happen inside your browser, and the only
thing Longshot stores is your own settings. It asks for no host permissions and
installs no persistent content script: it touches a page only on the tab you
invoke it on, and only for that capture.

Full policy: **[English](PRIVACY.md)** · **[简体中文](PRIVACY.zh-CN.md)**

## Support

Something broken, or a page that Longshot captures badly?
**[Open an issue](https://github.com/zluckyhou/longshot/issues/new/choose)** —
include the URL if you can, that is usually the whole diagnosis.
