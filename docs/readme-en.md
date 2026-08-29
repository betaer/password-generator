# Security Random Generator V2.1

[简体中文](../README.md) · [English](readme-en.md)

A browser-local utility for Password, Passphrase, PIN, Token, API Secret, UUID, Hex, Random Bytes, and BIP39 Mnemonic generation.

[Use V2.1](https://betaer.github.io/password-generator/index.html) · [V1.7.5 archive](https://betaer.github.io/password-generator/index-v1.75.html) · [Source](https://github.com/betaer/password-generator) · [![Visitors](https://visitor-badge.laobi.icu/badge?page_id=betaer.password-generator)](https://github.com/betaer/password-generator)

V2.1 uses one probability contract with nine specialized models. It separates exact generator metrics from empirical pattern analysis and attack-scenario estimates:

- Exact expected guess rank for a uniform finite space is `(N + 1) / 2`.
- Password and Passphrase may show local zxcvbn pattern estimates and explicit-rate attack scenarios.
- UUID is labeled “Identifier, not a secret”; UUID, raw bytes, tokens, Hex, and BIP39 do not show generic password-hash crack times.
- Generation jobs freeze mode, config, and quantity. Epoch checks and cancellable Workers prevent stale mixed-mode results.
- PIN uses completion-count sampling and defaults to exact without-replacement batches.
- Random Bytes keeps an exact symbolic `2^n` space, lazy encoding, SHA-256, and global memory/clipboard budgets.
- V2.1 Passphrase and BIP39 assets are independent, content-hashed, and SHA-256 verified.
- BIP39 generation requires a non-persistent acknowledgement of browser, extension, clipboard, and wallet-compatibility boundaries.
- The workspace follows three Chinese steps, with Chinese labels on the left and English navigation aids on the right. All nine configuration and result views use Chinese product copy.
- Results are visible by default. Hide/show updates only the existing presentation layer, preserving card geometry, scroll position, and keyboard focus.
- Batch results use compact rows with per-result copy, hide, delete, and in-place regenerate actions. Shared exact metrics, observed-pattern summary, attack scenarios, and generation-model details are shown once per batch.
- “生成记录 History” is a compact single-line list with click-to-copy, per-entry deletion, and temporary hover/focus tooltips. Back-to-top, GitHub 999+, and fixed public share-copy actions are restored at the lower right.
- Password restores L1–L8 complexity recipes, common length/quantity shortcuts, and exact custom inputs. Applying a recipe also restores a valid default symbol pool.
- Background BIP39 English preloading now commits the ready state even while Password remains the active mode.
- Browser assets use content-hashed filenames plus an HTML product `2.1.0` / runtime `2.0.1` handshake.

All random choices use the browser Web Crypto API, rejection sampling, and unbiased Fisher–Yates. Local zxcvbn analysis is empirical and separate from generator probability. The pinned PIN source contains 68,202 unique six-digit numeric candidates, while the disclosed heuristic policy blocks only its configured rank threshold and the exact constraint intersection.

Password and Passphrase show three explicit assumptions: an online rate-limited scenario, a slow password hash/KDF scenario, and a fast offline scenario. These are estimates, not a security guarantee.

## Privacy boundaries

- Generation never writes to the clipboard. Copying is always explicit.
- Results are plaintext-visible by default. Hide/show uses a fixed-length visual mask without rebuilding the card; plaintext remains in the DOM, and large results show a short preview or summary.
- Generation-model details redact free-text pools, prefixes, separators, and complete word arrays.
- History is off by default, memory-only when enabled, not persisted across browser sessions, can be cleared at any time, and is limited to 100 entries plus an 8 MiB secret-byte budget.
- The share button copies only fixed public V2.1 promotional text and URL; it does not read mode, configuration, generated values, History, hash, or query.
- `localStorage` contains only allow-listed structured settings, never results, History, or free-text fields.
- JavaScript strings cannot be reliably zeroized. Mutable byte arrays are overwritten where controllable.

## Google Analytics isolation

GA is retained as an isolated cookieless page view. Google JavaScript runs only inside an iframe with `sandbox="allow-scripts"`, without `allow-same-origin`, referrer data, or a message bridge. The parent page does not execute Google JavaScript and never sends generator type, config, input, prefix, result, or mnemonic to the iframe.

Cookieless measurement requests can still carry standard browser and network metadata, so the project does not claim complete anonymity. Playwright intercepts the actual `g/collect` URL, body, and headers and verifies the fixed page fields, absence of Cookie, and absence of a high-entropy secret sentinel.

For an independent check, open DevTools → Network, generate/reveal/copy sample values, and confirm that no request contains a `generated_value` parameter or generated plaintext.

## Run and verify

```bash
npm ci
npm run build:v21
npm run serve
```

Open `http://127.0.0.1:8765/index.html`.

```bash
npm run test:v21
npm run test:coverage:v21
npm run test:e2e:v21
npm run verify:v21
```

The Pages workflow deploys only after the V1.7.5 archive, V2/V2.0.1 probability-core, and V2.1 tests; all three coverage gates; browser/GA network checks; `npm audit`; reproducible artifact comparison; and build-provenance attestation pass. `index.html` is the formal V2.1 entry, `index-v1.75.html` is the V1.7.5 archive, and `index-2.1.html` is a noindex compatibility redirect.

## Boundaries

This is a generator and analysis utility, not a password manager, wallet, key-custody service, or hardware random-number device. Generator metrics apply only to unmodified output. High-value BIP39 use should prefer a hardware wallet or a verified offline build. UUIDs must not be used as credentials or capabilities.
