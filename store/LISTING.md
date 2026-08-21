# Chrome Web Store listing — Longshot 0.2.0

Everything needed for the submission, ready to paste. Field names match the
developer console. Character counts are given where the console enforces a cap.

- Package: `store/longshot-0.2.0.zip` (80 KB)
- Images: `store/assets/`
- Privacy policy: https://github.com/zluckyhou/longshot/blob/main/PRIVACY.md

---

## 1. Package

Upload `store/longshot-0.2.0.zip`. Contents: `manifest.json`, `src/`, `icons/`,
`_locales/`, `fonts/` — no source maps, no `node_modules`, no design files.

Manifest V3, version `0.2.0`, `default_locale: en`, minimum Chrome 116.

---

## 2. Store listing — English

**Language:** English (this is the default locale, fill it first)

**Item name** (75 max)

```
Longshot — Scrolling Screenshot
```

**Summary** (132 max — currently 110)

```
Capture a full-page scrolling screenshot of any webpage, then crop, annotate and copy it. Nothing is uploaded.
```

**Description**

```
Longshot takes one image of an entire webpage — not the part you can see, the
whole thing — and hands it straight to an editor so you can finish the job
without opening anything else.

WHAT IT DOES

• Full-page capture. Longshot scrolls the page for you, captures it screen by
  screen and stitches the result into a single tall image, at the page's real
  resolution.
• Handles the pages that usually break scrolling screenshots. Fixed headers are
  kept off every screen but the first, sticky elements are put back where they
  belong in the document, and lazy-loaded images are pre-scrolled so nothing
  arrives blank.
• A real editor, not a preview. Crop to the part that matters, draw arrows,
  boxes, ellipses and freehand marks, add text, pixelate anything private, and
  drop in a magnifier loupe that enlarges a detail in place so it stays
  readable at a glance.
• Export the way you want it. Set the output size, save as PNG or JPG, or copy
  the finished image straight to the clipboard and paste it into Slack, a doc
  or an issue.
• Keyboard-first. Alt+Shift+S captures. In the editor: V select, X crop,
  P draw, A arrow, R rectangle, O ellipse, M magnifier, B pixelate, T text.
  Shift constrains to a square or a circle, Space + drag pans, Cmd+Z undoes.

PRIVACY

Nothing is uploaded. There is no server, no account and no analytics — the
capture, the stitching, the editing and the export all happen inside your
browser, and the only thing Longshot stores is your own settings. Longshot asks
for no host permissions and installs no persistent content script: it touches a
page only on the tab you invoke it on, and only for that capture.

Full policy: https://github.com/zluckyhou/longshot/blob/main/PRIVACY.md
```

**Category:** Workflow & Planning
_(second choice if you prefer: Tools)_

---

## 3. Store listing — 简体中文

**Language:** Chinese (Simplified) — add via "Add language" on the listing tab

**Item name**

```
Longshot 滚动截图
```

**Summary**

```
一键截取整页滚动长图，然后裁剪、标注、复制。全程本地处理，不上传。
```

**Description**

```
Longshot 把一整个网页拍成一张图——不是你看得见的那一屏，而是整页——然后
直接交给内置编辑器，不用再打开任何别的工具。

功能

• 整页截取。Longshot 替你滚动页面，逐屏采集，再拼接成一张长图，保持页面
  原始分辨率。
• 专门处理那些会让滚动截图翻车的页面。固定导航栏只保留在第一屏，吸顶元素
  会被放回它在文档里本来的位置，懒加载图片会被预先滚动加载，不会拍出空白。
• 是真正的编辑器，不是预览。裁掉不要的部分，画箭头、方框、椭圆和自由笔迹，
  加文字，把隐私内容打码，还能放一个放大镜到图上——它会就地放大细节，让关键
  信息一眼可读。
• 按你的需要导出。可设置输出尺寸，存成 PNG 或 JPG，也可以直接复制到剪贴板，
  粘进飞书、文档或 issue 里。
• 键盘优先。Alt+Shift+S 截图。编辑器里：V 选择、X 裁剪、P 画笔、A 箭头、
  R 矩形、O 椭圆、M 放大镜、B 打码、T 文字。按住 Shift 约束为正方形或正圆，
  空格 + 拖拽平移画布，Cmd+Z 撤销。

隐私

不上传任何内容。没有服务器，没有账号，没有任何统计埋点——采集、拼接、编辑、
导出全部在你的浏览器里完成，Longshot 唯一保存的是你自己的设置。它不申请任何
host 权限，也不注入常驻内容脚本：只在你主动调用的那个标签页上生效，且仅持续
到该次截图结束。

完整政策：https://github.com/zluckyhou/longshot/blob/main/PRIVACY.zh-CN.md
```

---

## 4. Graphics

| Slot | File | Size |
|---|---|---|
| Store icon | `assets/store-icon-128.png` | 128×128 |
| Screenshot 1 | `assets/shot-1-popup.png` | 1280×800 — the popup over a real page |
| Screenshot 2 | `assets/shot-2-annotate.png` | 1280×800 — editor, box + ellipse + arrow |
| Screenshot 3 | `assets/shot-3-mask.png` | 1280×800 — editor, pixelate + magnifier |
| Screenshot 4 | `assets/shot-4-fullpage.png` | 1280×800 — one screen vs. the whole page |
| Small promo tile | `assets/promo-small-440x280.png` | 440×280 |
| Marquee promo tile | `assets/promo-marquee-1400x560.png` | 1400×560 |

The screenshots carry no baked-in text, so the same set serves both the English
and the Chinese listing.

---

## 5. Privacy practices tab

**Single purpose description**

```
Longshot has one purpose: to capture a scrolling screenshot of the page the
user is currently viewing, and to let the user crop, annotate and export that
image locally. Every feature in the extension serves that one task.
```

**Permission justifications**

| Field | Text to paste |
|---|---|
| `activeTab` | Longshot needs to read the page the user is currently viewing in order to photograph it, and only at the moment the user clicks the toolbar button or presses the keyboard shortcut. activeTab gives exactly that scope and nothing broader. |
| `scripting` | Longshot injects a measuring-and-scrolling routine into the invoked tab so the page can be scrolled and captured screen by screen, then removed. This is required because page height and scroll behaviour can only be determined from inside the page. |
| `downloads` | Used to save the finished screenshot to the user's computer when the user chooses Save. No download is ever started without a user action. |
| `storage` | Stores the user's own preferences — image format, JPEG quality, per-screen wait time, three capture options and the post-capture action — so they persist between sessions. No page or user content is stored. |
| `offscreen` | The captured screens are stitched into one tall image on a canvas. A Manifest V3 service worker cannot use a canvas, so an offscreen document is required to perform the stitching. |
| `clipboardWrite` | Used to place the finished image on the clipboard when the user presses Copy, so it can be pasted into another application. |

**Remote code:** No, I am not using remote code. All JavaScript is contained in
the package; the two bundled font files are local and there are no remote
scripts, no `eval` of fetched code and no CDN.

**Data usage — what does your item collect?**
Tick **nothing**. Longshot collects none of the listed categories: no personally
identifiable information, health, financial, authentication, personal
communications, location, web history, or user activity, and no website
content leaves the device.

**The three certifications** — all three are true for Longshot, tick all three:

- [x] I do not sell or transfer user data to third parties, apart from the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**

```
https://github.com/zluckyhou/longshot/blob/main/PRIVACY.md
```

---

## 6. Remaining fields

| Field | Value |
|---|---|
| Official URL / Homepage | `https://github.com/zluckyhou/longshot` |
| Support URL | `https://github.com/zluckyhou/longshot/issues` |
| Mature content | No |
| Visibility | Public |
| Distribution | All regions |
| Pricing | Free |

---

## 7. Things to decide before you hit Submit

1. **Developer email verification.** The console requires a verified contact
   email on the account before a listing can be published. This is set on the
   Account tab, not per item.
2. **Two existing items.** You mentioned wanting to unpublish two other
   extensions. If either of them overlaps with Longshot, do the takedown first —
   a near-duplicate listing is a common rejection reason.
