# Contributing to Longshot

Thanks for helping make Longshot better. Bug reports, capture edge cases,
documentation fixes, translations, and focused code changes are welcome.

## Before you start

- Search the existing issues before opening a new one.
- Use the bug report template for broken captures and include the page URL when
  it is safe to share.
- Never attach screenshots that contain credentials, personal communications,
  or other private information.
- For a larger feature, open an issue first so the approach can be discussed
  before implementation work begins.

## Local setup

Longshot has no build step or runtime dependencies:

1. Clone the repository.
2. Open `chrome://extensions` in Chrome 116 or newer.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository folder.

After editing the extension, use the reload button on `chrome://extensions`
before testing again.

## Validation

Run these checks before submitting a pull request:

```bash
bash scripts/validate.sh
```

If you use pre-commit, the same checks are available with
`uvx pre-commit run --all-files`.

Then test the affected behavior by loading the unpacked extension. Capture at
least one ordinary document page and, for capture changes, one long page with a
sticky or fixed header.

## Pull requests

- Keep each pull request focused on one change.
- Explain the user-visible behavior and how it was tested.
- Update both English and Simplified Chinese strings when UI copy changes.
- Do not add remote scripts, analytics, host permissions, or data collection
  without discussing the privacy impact first.
- Do not commit generated ZIP packages or `node_modules`.

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).
