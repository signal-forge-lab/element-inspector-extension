# Prismora Privacy Policy

Last updated: 2026-09-02

[English](PRIVACY.en.md) | [日本語](PRIVACY.md)

## 1. Scope

This Privacy Policy applies to the Chrome extension `Prismora — Web Element Inspector` ("Prismora"). Prismora is a local tool that runs only when the user explicitly activates it to inspect web elements on a page.

## 2. Information Prismora can access

To provide its features, Prismora may read the following information inside the browser from the active page and corresponding iframes:

- DOM tag names, attributes, text, and HTML fragments;
- element coordinates, box-model data, computed styles, and CSS custom properties;
- locators such as CSS Selector, XPath, and JS Path;
- accessibility information that can be inferred from the normal DOM;
- limited HTML event attributes and DOM0 event-property information;
- open Shadow DOM and iframe path information;
- temporary CSS edits applied by Prismora;
- page URL, frame URL, and page title.

Page content may itself contain personal or confidential information originating from the user or the visited site.

## 3. Purpose of use

Prismora uses the information it reads only to provide user-requested features such as:

- visualizing and inspecting selected elements;
- displaying DOM hierarchy, styles, accessibility information, and locators;
- temporary CSS editing, undo, and reset;
- selection history and pinned comparisons;
- generating Standard JSON and Ancestor detail JSON;
- generating AI Snapshots for a selected element, the current viewport, or the current frame's full page;
- copying data to the clipboard or saving JSON files when the user requests it.

Prismora does not use this information for advertising, tracking, behavioral analytics, profiling, or credit evaluation.

## 4. Collection, transmission, and sharing

Prismora does not collect, transmit, or share page information with the developer or third-party servers.

Prismora does not include:

- external API or analytics-service communication;
- advertising SDKs;
- telemetry or crash-report uploads;
- account creation or login;
- uploads to developer-operated servers.

When the user chooses copy or save, the selected information is written to the user's own clipboard or local file. If an AI Snapshot is generated for `Current viewport` or `Full page`, the output can include content beyond the selected element. Storage or onward sharing after export is controlled by the user.

## 5. Storage and retention

Prismora does not persist DOM analysis results, selection history, pinned items, temporary edits, or panel settings in Chrome Storage, localStorage, sessionStorage, or IndexedDB. These values are held in browser memory only.

They are discarded when Prismora is closed, the top page reloads or navigates, the target tab is closed, or the extension is reloaded or disabled. If only a child iframe reloads or navigates, references and temporary state for that iframe are discarded. Historical selection or pinned snapshots retained by the top frame can remain in memory until Prismora closes or the top page reloads.

Files explicitly saved by the user and clipboard content are outside Prismora's retention control.

## 6. Temporary page changes

When temporary CSS editing is used, Prismora adds session-specific temporary attributes and a dedicated stylesheet to the page.

- Existing `style` attributes are not modified.
- Temporary attributes and the stylesheet are removed on Reset or when Prismora closes.
- If an attribute with the same name existed before Prismora used it, the original value is restored.
- Prismora's temporary internal attributes are excluded from copied or saved JSON.

## 7. Chrome permissions

Prismora declares the `clipboardWrite` permission so that user-requested locators, CSS, JSON, and AI Snapshots can be copied to the clipboard.

The Content Script is configured for `<all_urls>` and `all_frames` so that elements can be selected and inspected in the page and its iframes after the user activates Prismora. While Prismora is inactive, it does not perform element selection, analysis, or the frame-context handshake.

The `postMessage` handshake used to construct iframe paths can be observed by page scripts. For that reason, its context is limited to a correlation token, hierarchy depth, and whether the frame element is `iframe` or `frame`. It does not include parent-frame CSS selectors, URLs, `name`, `title`, `src`, `aria-label`, or similar attribute values. The token is not used as an authentication credential.

## 8. Third-party disclosure

Prismora does not sell, rent, use for advertising, or provide user data to third parties. The developer does not retain user page data through Prismora.

## 9. Security

Prismora is designed to operate locally and reduce exposure by not sending page content to external services. However, copied JSON, locators, CSS, or AI Snapshots can contain page content, URLs, form values, or internal identifiers. AI Snapshot output excludes the actual value of password inputs, but other displayed text or form values may be included. Review exported content before sharing it with another party.

## 10. Changes

If Prismora's data-processing behavior changes, this policy and the applicable Chrome Web Store disclosures will be updated. Material changes may also be announced in release notes or the extension UI.

## 11. Contact

For privacy questions, use the public repository's Issue Tracker:

`https://github.com/signal-forge-lab/element-inspector-extension/issues`

Do not post page contents, credentials, cookies, personal information, or complete generated JSON from a sensitive page in a public issue.
