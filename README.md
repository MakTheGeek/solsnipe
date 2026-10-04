# SolSnipe Bot — Production Solana Token Sniper & Risk Management System

[![Solana](https://img.shields.io/badge/Solana-Mainnet--Ready-14F195?logo=solana)](https://solana.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express)](https://expressjs.com)
[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite)](https://vitejs.dev)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-2496ED?logo=docker)](https://www.docker.com)
[![Tests](https://img.shields.io/badge/Tests-14%20Passing-brightgreen)](#testing)

SolSnipe is an institutional-grade, high-throughput Solana token sniping and risk engine. It continuously monitors Telegram alpha channels, extracts Solana token mint addresses, runs deep on-chain validation (RugCheck, DexScreener, GMGN, Gemini AI), executes fast swaps via Jupiter v6 and Jito MEV-protected bundles, and manages active trades with algorithmic Take Profit, Stop Loss, Trailing Stops, and Stagnation auto-exits.

---

## ⚠️ Security Notice & Mandatory Credential Rotation

> **CRITICAL**: If you cloned or downloaded any prior version of this codebase, assume all previously committed files (`sniper-config.json`, `telegram-auth.json`, `cookies.txt`) contained compromised secrets.
>
> 1. **Do not use any previously exposed private key**. Transfer funds to a fresh wallet.
> 2. **Terminate active Telegram sessions** and regenerate API credentials on [my.telegram.org](https://my.telegram.org).
> 3. Refer to [SECURITY.md](./SECURITY.md) for full incident remediation and `git-filter-repo` scrubbing instructions.

---

## Architecture

```
                    ┌─────────────────────────┐
                    │ Telegram Alpha Channels │
                    └────────────┬────────────┘
                                 │
                                 ▼
                     Telegram MTProto Listener
                                 │
                                 ▼
                    Regex Token Mint Extractor
                                 │
                                 ▼
                 Deduplication & Idempotency Lock
                                 │
                                 ▼
                 Multi-Source On-Chain Analysis
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
    DexScreener API         RugCheck API            GMGN & Gemini
(Liquidity, Vol, FDV)   (Mint/Freeze Authority) (Holders, Wash Trades)
         └───────────────────────┬───────────────────────┘
                                 │
                                 ▼
                       Rule Evaluation Engine
                      (7 Configurable Filters)
                                 │
                        Passed Criteria?
                       ┌─────────┴─────────┐
                      YES                  NO
                       │                   │
                       ▼                   ▼
                 Risk Manager        Feed Rejection Log
         (Position Cap, Loss Limit,   (Stored in State)
          Circuit Breaker Status)
                       │
                       ▼
           Execution Router Decision
          ┌────────────┴────────────┐
       SIMULATION                  LIVE (Dual Lock)
          │                                 │
          ▼                                 ▼
  Synthetic Swap Router           Jupiter v6 / Jito MEV
  (Zero Slippage/Risk)            (Slippage Cap, Priority Fees)
          └────────────┬────────────┘
                       │
                       ▼
            Active Position Manager
           (Realtime Poller: 3s Loop)
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    Take Profit    Stop Loss   Trailing Stop / Stagnation
         └─────────────┼─────────────┘
                       │
                       ▼
             Realtime SSE Dashboard
             (Positions, PnL, Trades)
```

---

## Key Features

1. **Defense-in-Depth Security**:
   - Zero-secret disk persistence: Private keys are loaded into server memory via environment variables or authenticated session import.
   - Removed vulnerable `/api/wallet/export` endpoints.
   - Cryptographic PBKDF2/SHA-256 PIN & Password hashing with `crypto.timingSafeEqual`.
   - Brute-force lockout (5 consecutive failed attempts trigger a 30s lockout).
   - Strict `requireAuth` middleware protecting all sensitive endpoints.
   - Dual-lock safety gate for live trading (`LIVE_TRADING_ENABLED=true` + valid wallet).

2. **Automated Risk Management & Circuit Breaker**:
   - Hard server-side caps: `MAX_POSITION_SIZE_SOL`, `MAX_DAILY_LOSS_SOL`, `MAX_OPEN_POSITIONS`, `MAX_SLIPPAGE_BPS`.
   - Automatic circuit breaker trips upon 4 consecutive execution failures or when daily loss limit is reached.
   - Idempotency locks prevent race conditions and concurrent double-buys on the same mint address.

3. **Multi-Source Token Vetting**:
   - **DexScreener**: Validates minimum liquidity ($ USD), volume, age, and 5m price momentum.
   - **RugCheck**: Verifies mint authority and freeze authority are disabled/renounced; checks danger scores.
   - **GMGN**: Analyzes top-10 holder concentration and suspicious deployer history.
   - **Gemini AI**: Contextual threat intelligence and summary generation.

4. **Trade Execution & Position Management**:
   - **Jupiter v6 Swap API**: Ultra-low latency swap routing with priority fee optimization.
   - **Jito MEV Bundles**: Front-running and sandwich attack protection via direct tip floor routing.
   - **Simulation Mode**: Real-time mock swaps with realistic slippage simulation for paper trading.
   - **Automated Exits**: Configurable multi-target Take Profit, Stop Loss, Trailing Stops with trigger activation, and Stagnation time-based exits.

5. **Real-Time Reactive Dashboard**:
   - Live Server-Sent Events (SSE) stream for instant updates to positions, prices, signals, and execution status.
   - Real-time charting, PnL tracking, win rate analytics, and manual token analyzer.

---

## Getting Started

### Prerequisites

- Node.js 20+ LTS
- npm or Docker

### Installation

```bash
# Clone the repository
git clone https://github.com/blocksoara/Solsnipe_Bot.git
cd Solsnipe_Bot

# Install dependencies
npm install

# Copy environment variables template
cp .env.example .env
```

### Environment Configuration

Configure `.env` with your parameters:

```ini
PORT=3000
NODE_ENV=production
DATA_DIR=./server/data

# Security PIN or Passphrase for Web UI Access
SECURITY_PIN=your-secure-pin-here

# Trading Mode (Dual Safety Switch)
# Set to 'true' ONLY when ready for real on-chain execution with real SOL
LIVE_TRADING_ENABLED=false

# Solana Configuration (Never commit private keys to Git!)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=your_base58_encoded_private_key_here

# Risk Controls
MAX_POSITION_SIZE_SOL=0.5
MAX_DAILY_LOSS_SOL=2.0
MAX_OPEN_POSITIONS=5
MAX_SLIPPAGE_BPS=150

# Optional Integrations
JUPITER_API_URL=https://quote-api.jup.ag/v6
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
GEMINI_API_KEY=your_gemini_api_key
```

### Running Locally

```bash
# Run in development mode (TypeScript with hot reload)
npm run dev

# Run test suite
npm test

# Build for production
npm run build

# Start production server
npm start
```

### Running with Docker

```bash
# Build and run container with persistent data volume
docker compose up -d --build

# View logs
docker compose logs -f solsnipe-bot

# Stop container
docker compose down
```

---

## API Reference

### Authentication

Protected endpoints require authentication. Include either:
- Cookie: `solsnipe_session=<token>` (automatically handled in browser)
- Header: `Authorization: Bearer <token>`

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/health` | Health & system status | No |
| `POST` | `/api/security/setup` | Initialize security PIN/password | No |
| `POST` | `/api/security/verify` | Authenticate with PIN/password | No |
| `POST` | `/api/security/logout` | Invalidate active session | Yes |
| `GET` | `/api/events` | SSE Realtime Stream | Yes |
| `GET` | `/api/config` | Retrieve bot settings | Yes |
| `POST` | `/api/config` | Update bot settings | Yes |
| `GET` | `/api/state` | Current trading state & open positions | Yes |
| `POST` | `/api/manual-snipe` | Trigger manual token snipe | Yes |
| `POST` | `/api/sell-position` | Execute manual sell on position | Yes |
| `POST` | `/api/position/update-targets` | Update TP/SL on active position | Yes |
| `GET` | `/api/wallet` | Wallet balance & public address (No PK) | Yes |
| `POST` | `/api/wallet/import` | In-memory wallet import | Yes |
| `POST` | `/api/risk/reset-circuit-breaker` | Reset tripped circuit breaker | Yes |

---

## Testing

The project includes unit and integration tests covering security rules, risk limits, exit math, and middleware:

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration
```

---

## License

Apache-2.0. See [LICENSE](./LICENSE) for details.
