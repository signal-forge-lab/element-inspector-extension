# Prismora — Web Element Inspector

English | [日本語](README.md)

Prismora is a Chrome extension for visually selecting DOM elements and inspecting locators, hierarchy, styles, accessibility information, AI-oriented snapshots, temporary CSS edits, and DOM snapshots.

## Install for development

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository directory.
4. Open a target page and click the Prismora toolbar icon.

Click the icon again, use the inspector window's close control, or press `Esc` to stop inspection.

## Main capabilities

- CSS Selector, XPath, and JavaScript-path inspection.
- Parent/child navigation and selection history.
- Open Shadow DOM and iframe inspection where browser permissions allow it.
- Computed style and box-model inspection.
- Temporary CSS editing.
- Accessibility and event-related inspection.
- Copy/export helpers for structured element data and AI-oriented snapshots.

## Privacy and security

Prismora operates in the browser context of pages that you explicitly inspect. Review [PRIVACY.md](PRIVACY.md) for the current data-handling boundary.

The public repository must not contain `.env` files, credentials, private keys, workstation-specific paths, generated archives, runtime logs, or local workspace metadata. Those classes are excluded by `.gitignore`.

## Development files

- `manifest.json` — Chrome Manifest V3 definition.
- `background.js` — service-worker/background behavior.
- `content.js` / `inspector.js` — inspection runtime and UI logic.
- `tests/` — regression tests.
- `DEVELOPER_GUIDE.md` — implementation guidance.
- `THIRD_PARTY_NOTICES.md` — third-party notices.

## Status

Prismora is under active development. Browser DOM and extension-platform changes can require compatibility updates.
