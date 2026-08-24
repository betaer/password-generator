# Password Generator

[简体中文](../README.md) · [English](readme-en.md)

A browser-local password generator for **random passwords, passphrases, and PINs**, with fine-grained generation rules, format-oriented test schemes, and quantitative strength analysis based on each generated result.

> **Password Policy Compiler / Credential Policy Generation and Validation Tool**

[Live app](https://betaer.github.io/password-generator/) · [Passwords](https://betaer.github.io/password-generator/#password) · [PINs](https://betaer.github.io/password-generator/#pin) · [Passphrases](https://betaer.github.io/password-generator/#words) · [![Visitors](https://visitor-badge.laobi.icu/badge?page_id=betaer.password-generator)](https://github.com/betaer/password-generator)

![Password Generator social preview](../assets/social-preview.png)

## Why use it

- **Cryptographic randomness:** core random choices use the browser's Web Crypto API, not `Math.random()`.
- **Browser-local generation:** passwords, PINs, passphrases, and user input are not sent to a project server.
- **Precise rules:** control length, character classes, symbol ratios, boundary types, repetition, and excluded characters.
- **Pattern-aware analysis:** compare theoretical search space, zxcvbn predictability, and three explicit attack models.

## Core capabilities

| Mode | Capabilities | Typical uses |
|---|---|---|
| Random passwords | 4–512 characters, batches, four character classes, symbol ratios, start/end rules, ambiguous-character exclusion | Website passwords, master passwords, API tokens, machine credentials, test strings |
| PINs | Length, leading zero, corpus-backed common-PIN filtering, repeated digits, sequential-digit limits | Device codes, access codes, numeric test data |
| Passphrases | 1,296- and 7,776-word core packs, six 1,024-word theme packs, casing and separators | Long passphrases designed to be easier to type and segment |
| Format schemes | Numeric formats, ETH/TRON/BTC address-shaped strings, 64-hex private-key-shaped strings | UI, form, database, and demo-data testing |
| Strength analysis | Theoretical space, zxcvbn patterns, effective guesses, three attack models, eight levels | Separating raw combinations from practical predictability |

Generating or regenerating automatically copies the result to the clipboard. History is stored in the current browser session by default.

## Randomness strategy

### Web Crypto and rejection sampling

Core random selection uses:

```js
crypto.getRandomValues(buffer)
```

Random indices are not produced with a direct `randomUint32 % size`. The implementation first computes the largest accepted range divisible by the candidate-pool size and resamples values outside that range. This **rejection-sampling** step avoids modulo bias when a character or word pool does not divide `2³²` evenly.

### Random-password rules

- Lowercase, uppercase, digits, and symbols can be enabled independently or selected together.
- “Require every class” ensures that every enabled class appears in the result.
- Symbols support either a percentage range or a fixed count; a fixed count is clamped when password length decreases.
- Start and end character types are linked to the enabled character classes; unavailable choices are disabled.
- Ambiguous groups such as `iIlL1` and `0Oo` can be excluded, with an additional custom exclusion list.
- The default random-password profile is one 32-character result, all four classes enabled, and a 20%–80% symbol range.

## Passphrases and word packs

| Pack | Size | Theoretical entropy per word | Loading |
|---|---:|---:|---|
| Common short | 1,296 | about 10.34 bits | Embedded startup pack |
| Memorable long | 7,776 | about 12.92 bits | Loaded on demand |
| Technology and software | 1,024 | 10 bits | Theme pack loaded on demand |
| Cloud and DevOps | 1,024 | 10 bits | Theme pack loaded on demand |
| Network and security | 1,024 | 10 bits | Theme pack loaded on demand |
| Finance and Web3 | 1,024 | 10 bits | Theme pack loaded on demand |
| Science and space | 1,024 | 10 bits | Theme pack loaded on demand |
| Business and office | 1,024 | 10 bits | Theme pack loaded on demand |

Equal word counts do not provide equal entropy across packs:

| Pack | Entropy per word | 4 words | 6 words |
|---|---:|---:|---:|
| 1,024-word theme pack | 10 bits | 40 bits | 60 bits |
| 1,296-word common pack | about 10.34 bits | about 41.36 bits | about 62.04 bits |
| 7,776-word standard pack | about 12.92 bits | about 51.70 bits | about 77.55 bits |

Theme packs are focused and easier to turn into a mental theme, but their smaller pool makes them weaker than the standard pack at the same word count. **Use at least 6 words with a theme pack**; choose the 7,776-word pack or add more words when a larger random space is required.

The passphrase model is:

```text
entropy per word = log₂(actual selectable word count)
total entropy = word count × log₂(actual selectable word count)
```

For example, 12 independent and uniform draws from the 7,776-word pack provide approximately `12 × log₂(7,776) ≈ 155.1 bits` of theoretical entropy. This assumes that every word is selected independently and uniformly with cryptographically secure randomness. User-provided context is neither a random seed nor a source of additional entropy.

Word packs are hosted with the project and carry version, count, and SHA-256 metadata. Two small cold-start modules are compressed and embedded in the HTML to avoid a first-load dependency race, while the 7,776-word pack remains asynchronous to keep the initial document smaller.

## PIN rules

PIN generation can combine:

- leading-zero permission;
- obvious weak-PIN filtering;
- repeated-digit permission;
- ascending or descending runs limited to at most two digits.

Weak-PIN filtering is not a short hard-coded sample. A local risk index is built from a pinned SecLists revision and covers the complete **10,000-entry four-digit PIN ranking** plus **68,202 unique six-digit numeric PINs**. Runtime rules also detect identical digits, short cycles, ascending or descending sequences, date-shaped values, and keypad paths. High-frequency ranks and obvious patterns are blocked by default. When the sequential limit is enabled, a state-counting algorithm calculates the number of valid combinations under the active rules instead of applying a simple `10ⁿ` formula.

These filters remove some predictable choices; they do not give a short PIN the security of a long random password.

## Strength analysis

The result panel recalculates strength from the **actual generated value** instead of reusing the target level from the settings panel.

- Random passwords: calculates a theoretical space from observed length, classes, class placement, and pools, then uses `zxcvbn-ts` to detect dictionary words, repetitions, sequences, and keyboard paths.
- Passphrases: uses the actual word-pack size and actual word count.
- PINs: combines the valid combination space with common-PIN ranks and rule-based pattern analysis.
- Effective guesses: uses the more conservative of the theoretical average guess count and the pattern-model guess count.

The UI compares three models instead of presenting one speed as a fact:

| Attack model | Default rate | Meaning |
|---|---:|---|
| Online rate-limited attack | 100 guesses/hour | Illustrative login scenario with throttling, lockout, CAPTCHA, or MFA |
| Slow password hash | 10⁴ guesses/second | Illustrative offline verification using Argon2id, scrypt, bcrypt, or PBKDF2 |
| Fast offline hash | 10¹⁰ guesses/second | Severe database-leak scenario with a fast hash and highly parallel hardware |

`zxcvbn` is a **pattern estimator**, not an entropy source. Passphrases continue to use the actual word-pool size and independent draw count. Time estimates assume half the candidate space on average. **These results are attack-model estimates, not a security guarantee.** Rate limits, hash parameters, hardware, leaks, reuse, phishing, and compromised endpoints can change the real risk.

## Security implementation and verification

```text
Browser CSPRNG → Rejection Sampling → Pattern-aware analysis → Local result
```

- Passwords, PINs, passphrases, user input, and generated history form the **password data plane** and stay in the current browser. History uses only `sessionStorage`; it is not persisted across browser sessions, disappears when the tab is closed, and can be cleared at any time.
- `zxcvbn`, the PIN corpus, and word packs form a **static resource plane** loaded from same-origin paths; requests contain no generated values.
- Google Analytics is used only for anonymous visit measurement. There is no `generated_value` event parameter, and credentials or user input are never sent.
- Open browser **DevTools → Network**, generate and copy results, and verify that no request contains a generated value.

If Web Crypto is unavailable, generation stops instead of falling back to `Math.random()`. Component versions, corpora, and licenses are listed in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## Format-oriented test schemes

| Group | Included schemes |
|---|---|
| Numeric | 6-digit bank-PIN shape, 4-digit bank-PIN shape, 16-digit PAN-shaped string, 19-digit PAN-shaped string |
| Wallet-address shapes | ETH `0x + 40 hex`, TRON `T + Base58`, BTC Legacy, BTC P2SH, BTC Bech32 |
| Private-key shapes | 64-character hexadecimal strings labelled for BTC, ETH, and TRON testing |

> These schemes only match a selected **length, prefix, and character-set appearance**. They do not run Luhn validation, Base58Check/Bech32 checksums, public-key derivation, curve validation, or chain lookups. They must not be used as real bank-card numbers, wallet addresses, or private keys.

## Privacy and data boundaries

| Data | Handling |
|---|---|
| Passwords, PINs, passphrases, and input | Generated and analyzed locally; never included in network requests or analytics parameters |
| Settings | Stored in browser-local storage for restoration |
| History | Stored only in the current tab's `sessionStorage`; not persisted across browser sessions, removed when the tab closes, and can be cleared at any time |
| Word packs | Loaded from this site's static assets; no third-party random-word API is called at generation time |
| Google Analytics | Anonymous visit measurement only; no `generated_value`, credential, or input parameters |

Clipboard writes remain subject to browser permission and secure-context policies. If access is denied, the generated value stays visible for manual copying.

## Run locally

Opening `index.html` directly provides a compatibility mode. Use a local HTTP server to exercise asynchronous word-pack loading fully:

```bash
npm run serve
```

Then open:

```text
http://127.0.0.1:8765/
```

## Tests

```bash
npm test
```

The deterministic suite covers Web Crypto entry points, rejection sampling, sanitized zxcvbn output, three attack models, the full PIN corpus, actual-result analysis, word-pack integrity, format schemes, URL anchors, SEO metadata, and integrated page behavior.

## Project layout

```text
.
├── index.html                    # Deployable application entry
├── assets/                       # Social assets, security-analysis resources, and word packs
│   ├── data/                     # Versioned PIN risk index and source integrity metadata
│   ├── js/                       # Embedded analysis and passphrase runtimes
│   ├── modules/                  # On-demand PIN-risk analysis module
│   ├── vendor/                   # Browser zxcvbn analyzer and license
│   └── wordpacks/                # Manifest, JSON packs, and compressed resources
├── scripts/                      # Word-pack and embedded-module build scripts
├── tests/                        # Deterministic Node.js tests
├── docs/readme-en.md             # English README
├── THIRD_PARTY_NOTICES.md        # Third-party components, corpora, and licenses
├── llms.txt                      # Compact project facts for generative retrieval
├── robots.txt / sitemap.xml      # Subproject discovery hints
└── password-generator-icon.*     # Logo and favicon
```

## SEO, GEO, and social sharing

- The page includes bilingual titles, a description, canonical URL, Open Graph metadata, and a Twitter Card.
- `SoftwareApplication`, `WebSite`, and `BreadcrumbList` JSON-LD describe the product and its place in the site.
- A static SEO shell exposes core capabilities and privacy boundaries to crawlers that do not fully execute JavaScript.
- `llms.txt` provides compact, citable facts, while the root-site sitemap lists the canonical product URL.

## Word-list sources

- The common and standard packs are based on [EFF Diceware word lists](https://www.eff.org/dice) and preserve CC BY 3.0 US attribution.
- Theme packs use Datamuse as a build-time candidate source, followed by project-side cleaning, filtering, and cross-pack deduplication.
- Counts, sources, SHA-256 values, and compressed-file integrity data are recorded in `assets/wordpacks/manifest.v1.json`.

## Boundaries

- This is a generator and analysis tool, not a password manager, wallet, key-custody service, or hardware random-number device.
- For high-value master passwords or key material, also consider the security of the browser, device, extensions, clipboard, and endpoint environment.
- The repository currently has no open-source license. Publicly readable source does not by itself grant permission to copy, modify, or redistribute it.
