# Security Random Generator V2.0

[简体中文](../README.md) · [English](readme-en.md)

A browser-local security utility covering Password, Passphrase, PIN, Token, API Secret, UUID, Hex, Random Bytes, and BIP39 Mnemonic generation.

[Use V2.0](https://betaer.github.io/password-generator/index-2.0.html) · [Stable V1.7.5](https://betaer.github.io/password-generator/) · [Source](https://github.com/betaer/password-generator)

V1.7.5 remains unchanged at `index.html`; V2.0 has the separate `index-2.0.html` entry.

## What changed in V2.0

| Generator | Probability model |
|---|---|
| Password | Uniform sampling over outputs satisfying pool, symbol-ratio, required-class, boundary, space, and repetition constraints |
| Passphrase | Independent draws from the actual unique word list, including random capitalization position and every random separator |
| PIN | Completion-count dynamic programming and exact weak-set intersection |
| Token / API Secret / Hex / Random Bytes | Entropy is exactly the number of random bytes times eight; deterministic formatting adds no entropy |
| UUID | RFC 9562 v4 (122 random bits) and v7 (74 random bits) |
| Mnemonic | BIP39 ENT plus SHA-256 checksum with all ten official word lists |

Every result carries an immutable snapshot of how it was generated. The UI reports Generator Min-Entropy, exact Search Space, Effective Guess Count, and crack-time estimates from that model rather than inferring entropy from the resulting string. Local zxcvbn analysis may only make the effective guess count more conservative.

All random data comes from `crypto.getRandomValues()`. Integer choices use rejection sampling and shuffling uses unbiased Fisher–Yates. Generation stops visibly if Web Crypto is unavailable; it never falls back to `Math.random()`.

## Privacy boundaries

- Generate and Copy are separate. Generation never writes to the clipboard.
- Results are masked by default. Plaintext enters visible DOM only after an explicit reveal.
- Values longer than 4,096 characters are never rendered as plaintext; use explicit copy or binary download.
- History is off by default, memory-only when enabled, and capped at 100 entries.
- `localStorage` contains only allow-listed non-secret settings. V2 history is not stored in `sessionStorage` or IndexedDB.
- Google Analytics runs inside a sandboxed iframe with `allow-scripts` but without `allow-same-origin`. It receives a fixed V2 page location and has no parent/child message bridge. The parent page does not execute Google JavaScript.
- JavaScript strings cannot be reliably zeroized. The app clears mutable byte buffers where possible and releases references, but does not claim immediate complete memory erasure.

API-provider-shaped prefixes and wallet-private-key-shaped Hex options are test appearances only. They are not provider-issued credentials, do not validate an elliptic curve, and must not be used as real wallet keys.

## Run and test

```bash
npm install
npm run build:v2
npm run serve
```

Open `http://127.0.0.1:8765/index-2.0.html`.

```bash
npm test
npm run test:v2
npm run test:coverage:v2
```

Third-party versions, pinned corpus hashes, and licenses are documented in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## Boundaries

This is a generator and analysis tool, not a password manager, wallet, key-custody service, or hardware random-number device. Generator Min-Entropy applies to unmodified generator output; manual edits, truncation, reuse, or cherry-picking change the model.
