# Security Policy & Architecture

## 1. Critical Security Incident Advisory: Compromised Credentials

> **IMPORTANT**: In previous revisions of this repository, sensitive development artifacts were inadvertently committed to version control:
> - Solana private keys (`server/data/sniper-config.json`)
> - Telegram authentication sessions and phone numbers (`server/data/telegram-auth.json`)
> - Web session cookies (`cookies.txt`)
> - Hardcoded GMGN API keys and Telegram App credentials

### Mandatory Credential Rotation Checklist
If you have cloned or deployed any prior commit of this repository:
1. **Solana Wallet**: Transfer any remaining funds immediately from any previously configured address to a brand-new wallet generated in an isolated environment. Consider all prior keypairs permanently compromised.
2. **Telegram API & Sessions**: Terminate all active sessions under Telegram Settings -> Privacy and Security -> Devices. Regenerate your Telegram API ID & Hash on [my.telegram.org](https://my.telegram.org) if used.
3. **GMGN API Keys**: Revoke and re-issue all GMGN API keys via GMGN developer portal.
4. **RPC & Web Services**: Rotate any private RPC endpoints (Helius, QuickNode) and invalidate session cookies.

---

## 2. Scrubbing Git History

Deleting files from the working tree does **NOT** purge them from Git commit history. If publishing or hosting this repository publicly, you must scrub the history:

```bash
# Recommended: Use git-filter-repo (Python tool)
pip install git-filter-repo

# Run inside a fresh clone of the repository
git filter-repo --invert-paths \
  --path server/data/sniper-config.json \
  --path server/data/telegram-auth.json \
  --path server/data/processed-posts.json \
  --path server/data/security-config.json \
  --path cookies.txt \
  --path-glob '*.session*'

# Force push to remote (Caution: rewrites commit hashes)
git push origin --force --all
git push origin --force --tags
```

---

## 3. Production Security Architecture

### Key Principles

1. **Zero Secret Persistence**:
   - Private keys are **NEVER** written to disk, SQLite databases, or local JSON files.
   - Keys are supplied exclusively via environment variables (`SOLANA_PRIVATE_KEY`) or in-memory encrypted session import.
   - Private key export endpoints (`/api/wallet/export`) have been **completely removed**.
   - Private keys are stripped from all API outputs, Server-Sent Events (SSE), and server logs.

2. **Server-Side Authentication & Session Security**:
   - All mutating and sensitive endpoints (`/api/config`, `/api/manual-snipe`, `/api/sell-position`, `/api/wallet/*`, `/api/telegram/*`, etc.) strictly enforce server-side authentication (`requireAuth` middleware).
   - Passwords and PINs are hashed using salted cryptographic PBKDF2 / SHA-256 with constant-time comparison (`crypto.timingSafeEqual`) to prevent timing attacks.
   - Brute-force protection automatically locks out authentication attempts after 5 consecutive failures for 30 seconds.
   - Sessions are protected via cryptographically secure random session tokens transmitted via HTTP-only cookies or `Authorization: Bearer <token>`.

3. **Live Trading Dual-Lock Safety Gate**:
   - Live on-chain execution requires **both**:
     1. Operator server environment switch: `LIVE_TRADING_ENABLED=true`
     2. Valid Solana private key loaded in memory with verified balance.
   - In simulation mode, transactions are synthetically processed and **never** broadcast to the Solana network.

4. **Hard Server-Side Risk Limits**:
   - `MAX_POSITION_SIZE_SOL`: Caps any single snipe entry.
   - `MAX_DAILY_LOSS_SOL`: Hard stop on cumulative daily loss.
   - `MAX_OPEN_POSITIONS`: Limits concurrent active positions to prevent capital over-extension.
   - `MAX_SLIPPAGE_BPS`: Enforces slippage bounds to protect against sandwich attacks.
   - **Automated Circuit Breaker**: If consecutive RPC/swap errors occur or max daily loss is reached, new snipes are automatically suspended while open positions remain safeguarded.

5. **Defense-in-Depth & Transport Security**:
   - Strict Content Security Policy (CSP), X-Frame-Options, X-Content-Type-Options, and Referrer-Policy headers.
   - CORS restricted to configured host origins.
   - Sensitive error stack traces suppressed in production.
   - Rate limiting on API endpoints to prevent request flooding.

---

## 4. Reporting Security Vulnerabilities

Please report any identified security vulnerabilities responsibly to the repository administrators. Do not open public issues detailing active vulnerabilities.
