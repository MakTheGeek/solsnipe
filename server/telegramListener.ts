import path from 'path';
import { TelegramCall, TelegramStatus } from '../src/types';
import { config } from './config';
import { logger } from './logger';
import { StateStore } from './persistence/stateStore';

interface TelegramListenerOptions {
  channels?: string[];
  channel?: string;
  apiId?: number;
  apiHash?: string;
  phone?: string;
  sessionString?: string;
  stateStore: StateStore;
  onCall: (call: TelegramCall) => void;
  onCallUpdated?: (call: TelegramCall) => void;
}

export class TelegramListener {
  private channels: string[] = [];
  private apiId?: number;
  private apiHash?: string;
  private phone?: string;
  private sessionString?: string;
  private stateStore: StateStore;
  private onCall: (call: TelegramCall) => void;
  private onCallUpdated?: (call: TelegramCall) => void;

  private isRunning = false;
  private isConnecting = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private processedPostIds = new Set<string>();
  private calls: TelegramCall[] = [];
  private lastCheckTime = Date.now();
  private lastCallTime?: number;
  private phoneCodeHash?: string;
  private gramClient: any = null;
  private isAuthenticated = false;
  private authenticatedUser?: string;

  private totalAlertsReceived = 0;
  private totalDuplicatesFiltered = 0;
  private channelStats: Record<string, number> = {};
  private channelErrors: Record<string, string> = {};
  private invalidChannels: Set<string> = new Set();
  private eventHandlerRegistered = false;
  private recentTokenAddresses = new Map<string, number>();

  private isPublicPollingActive = false;
  private isPollingInProgress = false;
  private hasCompletedInitialFetch = new Set<string>();

  constructor(options: TelegramListenerOptions) {
    const rawChannels =
      options.channels ||
      (options.channel ? [options.channel] : config.TELEGRAM_CHANNELS.split(',').map((s) => s.trim()));
    const cleaned = rawChannels.map((c) => this.cleanChannelName(c)).filter(Boolean);
    // Ensure high-activity public Solana alert channels are present so calls are immediately received
    if (!cleaned.includes('dexscreener_solana')) {
      cleaned.unshift('dexscreener_solana');
    }
    if (!cleaned.includes('pumpdotfunalert')) {
      cleaned.unshift('pumpdotfunalert');
    }
    if (!cleaned.includes('solana_gems')) {
      cleaned.push('solana_gems');
    }
    this.channels = cleaned;

    this.apiId = options.apiId || config.TELEGRAM_API_ID;
    this.apiHash = options.apiHash || config.TELEGRAM_API_HASH;
    this.phone = options.phone || config.TELEGRAM_PHONE;
    this.sessionString = options.sessionString || config.TELEGRAM_SESSION_STRING;
    this.stateStore = options.stateStore;
    this.onCall = options.onCall;
    this.onCallUpdated = options.onCallUpdated;

    // Load persisted calls from state store
    this.calls = this.stateStore.loadTelegramCalls();

    // Load persisted account session if available
    const storedSession = this.stateStore.loadTelegramSession();
    if (storedSession) {
      if (storedSession.sessionString) this.sessionString = storedSession.sessionString;
      if (storedSession.apiId) this.apiId = storedSession.apiId;
      if (storedSession.apiHash) this.apiHash = storedSession.apiHash;
      if (storedSession.phone) this.phone = storedSession.phone;
      if (storedSession.username) this.authenticatedUser = storedSession.username;
    }

    // Load persisted post IDs for deduplication
    this.processedPostIds = this.stateStore.loadProcessedPostIds();

    // If calls store was empty (e.g. restart or fresh instance), reset stale processedPostIds
    // so the initial channel fetch can populate the feed immediately
    if (this.calls.length === 0 && this.processedPostIds.size > 0) {
      logger.info('TelegramListener', 'Calls store was empty; resetting stale processed post IDs to re-seed feed.');
      this.processedPostIds.clear();
      this.stateStore.saveProcessedPostIds(this.processedPostIds);
    }

    logger.info(
      'TelegramListener',
      `TelegramListener initialized (${this.calls.length} persisted calls loaded). Configured channels: ${this.channels.join(', ')}`
    );
  }

  private cleanChannelName(channel: string): string {
    return channel
      .replace(/^https?:\/\//i, '')
      .replace(/^(?:www\.)?(?:telegram\.me|t\.me)\//i, '')
      .replace(/^s\//i, '')
      .replace(/^joinchat\//i, '')
      .replace(/^@/, '')
      .replace(/\/.*$/, '') // Strip trailing paths or message IDs like /4437216
      .trim();
  }

  public getCalls(): TelegramCall[] {
    return this.calls;
  }

  public getStatus(): TelegramStatus {
    const isLive = this.isRunning && (this.isAuthenticated || this.isPublicPollingActive);
    return {
      connected: isLive,
      channel: this.channels.join(', '),
      channels: this.channels,
      lastCheck: this.lastCheckTime,
      lastCheckTime: this.lastCheckTime,
      lastCall: this.lastCallTime,
      lastCallTime: this.lastCallTime,
      totalCalls: this.calls.length,
      totalCallsDetected: this.calls.length,
      authenticated: this.isAuthenticated,
      isAuthenticated: this.isAuthenticated,
      authenticatedUser: this.authenticatedUser,
      userName: this.authenticatedUser,
      phone: this.phone,
      listenerType: this.isAuthenticated ? 'mtproto' : 'live_channel',
      statusMessage: this.isAuthenticated
        ? `Connecté en direct MTProto (@${this.authenticatedUser})`
        : isLive
        ? `Écoute active en direct (${this.channels.length} canaux Telegram)`
        : 'Arrêté',
      channelCounts: this.channelStats,
      channelStats: this.channelStats,
      channelErrors: this.channelErrors,
      totalAlertsReceived: this.totalAlertsReceived,
      totalDuplicatesFiltered: this.totalDuplicatesFiltered,
    };
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Start public web channel poller (works for public channels like pumpdotfunalert)
    this.startPublicChannelPolling();

    // 2. Attempt GramJS client connection if MTProto credentials exist
    if (this.apiId && this.apiHash) {
      await this.initGramClient();
    } else {
      logger.info('TelegramListener', 'No MTProto credentials configured. Using live public web feed & manual injection.');
    }
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    this.isPublicPollingActive = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.gramClient) {
      try {
        await this.gramClient.disconnect();
      } catch {}
      this.gramClient = null;
    }
    this.isAuthenticated = false;
    this.eventHandlerRegistered = false;
    logger.info('TelegramListener', 'Telegram listener stopped.');
  }

  /**
   * Starts periodic polling of public Telegram channels (t.me/s/<channel>)
   */
  public startPublicChannelPolling(): void {
    if (this.pollInterval) return;
    this.isPublicPollingActive = true;

    // Execute first poll immediately
    this.pollAllChannels().catch((err) => {
      logger.warn('TelegramListener', `Initial public channel poll error: ${err.message}`);
    });

    // Schedule subsequent polls every 10 seconds
    this.pollInterval = setInterval(() => {
      this.pollAllChannels().catch((err) => {
        logger.debug('TelegramListener', `Public channel poll interval error: ${err.message}`);
      });
    }, 10_000);

    logger.info('TelegramListener', `Active public channel polling started for [${this.channels.join(', ')}] (every 10s)`);
  }

  /**
   * Polls all configured Telegram channels via web preview
   */
  public async pollAllChannels(): Promise<{ polled: number; newCalls: number }> {
    if (this.isPollingInProgress) return { polled: 0, newCalls: 0 };
    this.isPollingInProgress = true;
    let newCallsCount = 0;

    try {
      this.lastCheckTime = Date.now();

      for (const rawCh of this.channels) {
        const clean = this.cleanChannelName(rawCh);
        if (!clean) continue;

        try {
          const res = await fetch(`https://t.me/s/${clean}`, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(8000),
          });

          if (!res.ok) {
            this.channelErrors[clean] = `HTTP ${res.status}`;
            continue;
          }

          const html = await res.text();
          if (!html.includes('tgme_widget_message_text')) {
            // Not a public channel with web preview (or requires login/invite)
            this.channelErrors[clean] = 'Aperçu web indisponible (canal privé ou groupe)';
            continue;
          }

          delete this.channelErrors[clean];
          const postRegex = /data-post="([^"]+)"[\s\S]*?<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
          let match;
          const posts: { postId: string; text: string; rawHtml: string }[] = [];

          while ((match = postRegex.exec(html)) !== null) {
            const postId = match[1];
            const rawHtml = match[2];
            const cleanText = rawHtml
              .replace(/<br\s*[\/]?>/gi, '\n')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&#33;/g, '!')
              .replace(/&#036;/g, '$')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&#39;/g, "'")
              .replace(/&quot;/g, '"')
              .replace(/&nbsp;/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();

            posts.push({ postId, text: cleanText, rawHtml });
          }

          const isFirstRun = !this.hasCompletedInitialFetch.has(clean) || this.calls.length === 0;
          this.hasCompletedInitialFetch.add(clean);

          if (isFirstRun) {
            // Ingest last 10 posts as historical archive on first run so feed is immediately populated
            const initialPosts = posts.slice(-10);
            for (const post of initialPosts) {
              const fullContent = `${post.text}\n${post.rawHtml}`;
              const ca = this.extractSolanaAddress(fullContent);
              if (ca) {
                const call = this.processIncomingMessage(fullContent, clean, post.postId, {
                  isHistorical: true,
                  canAutoSnipe: false,
                });
                if (call) newCallsCount++;
              }
            }
          } else {
            // Subsequent runs: new posts trigger live calls
            for (const post of posts) {
              const dedupeKey = `${clean}:${post.postId}`;
              const fullContent = `${post.text}\n${post.rawHtml}`;
              const ca = this.extractSolanaAddress(fullContent);
              if (!this.processedPostIds.has(dedupeKey)) {
                if (ca) {
                  const call = this.processIncomingMessage(fullContent, clean, post.postId, {
                    isHistorical: false,
                    canAutoSnipe: true,
                  });
                  if (call) newCallsCount++;
                }
              }
            }
          }
        } catch (chanErr: any) {
          this.channelErrors[clean] = chanErr.message || 'Fetch error';
        }
      }
    } finally {
      this.isPollingInProgress = false;
    }

    return { polled: this.channels.length, newCalls: newCallsCount };
  }

  private async initGramClient(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      // Dynamic import to avoid crash if telegram package is loading in non-node env
      const { TelegramClient } = await import('telegram');
      const { StringSession } = await import('telegram/sessions');

      const session = new StringSession(this.sessionString || '');
      this.gramClient = new TelegramClient(session, this.apiId!, this.apiHash!, {
        connectionRetries: 5,
        useWSS: false,
      });

      await this.gramClient.connect();

      const isAuthorized = await this.gramClient.isUserAuthorized();
      if (isAuthorized) {
        this.isAuthenticated = true;
        const me = await this.gramClient.getMe();
        this.authenticatedUser = me.username || me.firstName || me.phone;
        const savedSession = this.gramClient.session.save();
        this.sessionString = savedSession;
        this.stateStore.saveTelegramSession({
          sessionString: savedSession,
          phone: this.phone,
          apiId: this.apiId,
          apiHash: this.apiHash,
          username: this.authenticatedUser,
          savedAt: Date.now(),
        });
        logger.info('TelegramListener', `Telegram authenticated successfully as @${this.authenticatedUser}`);
        this.setupEventHandlers();
      } else {
        logger.info('TelegramListener', 'Telegram client connected but user authorization required (phone/code).');
      }
    } catch (err: any) {
      logger.warn('TelegramListener', `Failed to initialize Telegram GramJS client: ${err.message}`);
    } finally {
      this.isConnecting = false;
    }
  }

  private setupEventHandlers(): void {
    if (!this.gramClient || this.eventHandlerRegistered) return;
    try {
      const { NewMessage } = require('telegram/events');
      this.gramClient.addEventHandler(async (event: any) => {
        try {
          const message = event.message;
          if (!message || !message.message) return;
          const text = message.message;

          let channelName = 'mon_compte_telegram';
          let chatIdStr = '';

          try {
            const chat = await message.getChat?.();
            chatIdStr = String(message.chatId || chat?.id || '');
            if (chat?.username) {
              channelName = chat.username;
            } else if (chat?.title) {
              channelName = chat.title;
            }
          } catch {}

          const clean = this.cleanChannelName(channelName);

          // Check if this channel or chat is in user's monitored list
          const isMonitored =
            this.channels.length === 0 || // If no filter, listen to all
            this.channels.includes(clean) ||
            this.channels.includes(chatIdStr) ||
            this.channels.some((c) => channelName.toLowerCase().includes(c.toLowerCase()));

          if (!isMonitored) return;

          this.processIncomingMessage(text, channelName, message.id, {
            isHistorical: false,
            canAutoSnipe: true,
          });
        } catch (eventErr) {
          logger.debug('TelegramListener', 'Error processing new message event:', eventErr);
        }
      }, new NewMessage({}));
      this.eventHandlerRegistered = true;
      logger.info('TelegramListener', 'Telegram live event listener active on user account.');
    } catch (err: any) {
      logger.warn('TelegramListener', `Could not register Telegram event handler: ${err.message}`);
    }
  }

  /**
   * Extracts token name, symbol, and claimed market cap from Telegram message text
   */
  public extractMetadataFromText(text: string): { symbol?: string; tokenName?: string; marketCap?: string } {
    let symbol: string | undefined;
    let tokenName: string | undefined;
    let marketCap: string | undefined;

    // Pattern 1: Name [SYMBOL] or Name (SYMBOL) (e.g. terminal of chat[chat] or CLONES (CLONES))
    const bracketMatch = text.match(/(?:^|[\n\r]|<b>)\s*(?:[^\w\s]*\s*)?([A-Za-z0-9\s\-_]{2,30})\s*[\[\(]([A-Za-z0-9_\u4e00-\u9fa5]{2,12})[\]\)]/i);
    if (bracketMatch) {
      tokenName = bracketMatch[1].replace(/<[^>]+>/g, '').trim();
      symbol = bracketMatch[2].trim().toUpperCase();
    } else {
      // Pattern 2: $SYMBOL
      const dollarMatch = text.match(/\$([A-Za-z0-9_]{2,12})\b/);
      if (dollarMatch) {
        symbol = dollarMatch[1].toUpperCase();
      }
    }

    // Pattern 3: Market Cap: $38.9K or MC: $38.9K or MC: 38K
    const mcMatch = text.match(/(?:MC|Market\s*Cap):\s*(?:<code>)?\s*([$0-9.,]+[KkMmBb]?)/i);
    if (mcMatch) {
      marketCap = mcMatch[1].trim();
    }

    return { symbol, tokenName, marketCap };
  }

  /**
   * Parses contract address from Telegram text
   */
  public extractSolanaAddress(text: string): string | null {
    // 1. Direct DEX / platform URLs containing Solana address
    const pumpMatch = text.match(/pump\.fun\/(?:coin\/)?([1-9A-HJ-NP-Za-km-z]{32,44})/i);
    if (pumpMatch && pumpMatch[1] && pumpMatch[1].length >= 32) return pumpMatch[1];

    const dexscreenerMatch = text.match(/dexscreener\.com\/solana\/([1-9A-HJ-NP-Za-km-z]{32,44})/i);
    if (dexscreenerMatch && dexscreenerMatch[1] && dexscreenerMatch[1].length >= 32) return dexscreenerMatch[1];

    const birdeyeMatch = text.match(/birdeye\.so\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/i);
    if (birdeyeMatch && birdeyeMatch[1] && birdeyeMatch[1].length >= 32) return birdeyeMatch[1];

    // 2. Standard Solana Base58 address regex (32 to 44 characters)
    const regex = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g;
    const matches = text.match(regex);
    if (!matches) return null;

    // Filter out common false positives and stablecoins/programs
    const blacklist = new Set([
      'So11111111111111111111111111111111111111112', // WSOL
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
      '11111111111111111111111111111111', // System Program
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    ]);

    for (const match of matches) {
      if (match.length >= 32 && match.length <= 44 && !blacklist.has(match)) {
        return match;
      }
    }
    return null;
  }

  public processIncomingMessage(
    text: string,
    channel: string,
    messageId: number | string,
    options?: {
      isHistorical?: boolean;
      canAutoSnipe?: boolean;
      symbol?: string;
      tokenName?: string;
      claimedMarketCap?: string;
    }
  ): TelegramCall | null {
    this.totalAlertsReceived++;
    const tokenAddress = this.extractSolanaAddress(text);
    if (!tokenAddress) return null;

    // Deduplication Key: channel + messageId or tokenAddress
    const dedupeKey = `${channel}:${messageId}:${tokenAddress}`;
    if (this.processedPostIds.has(dedupeKey)) {
      // If already present in current memory calls, filter out
      const alreadyInCalls = this.calls.some((c) => c.tokenAddress === tokenAddress);
      if (alreadyInCalls) {
        this.totalDuplicatesFiltered++;
        return null;
      }
    }

    this.processedPostIds.add(dedupeKey);
    this.processedPostIds.add(`${channel}:${messageId}`);
    this.stateStore.saveProcessedPostIds(this.processedPostIds);

    // Cross-channel duplicate token check (1-hour window)
    const now = Date.now();
    const lastSeenForToken = this.recentTokenAddresses.get(tokenAddress);
    const isTokenDuplicate = Boolean(lastSeenForToken && now - lastSeenForToken < 3600_000);
    this.recentTokenAddresses.set(tokenAddress, now);

    if (isTokenDuplicate) {
      this.totalDuplicatesFiltered++;
      logger.info('TelegramListener', `Repeated signal for ${tokenAddress.slice(0, 8)} detected across channels. Auto-snipe disabled.`);
    }

    const meta = this.extractMetadataFromText(text);
    const symbol = options?.symbol || meta.symbol;
    const tokenName = options?.tokenName || meta.tokenName;
    const claimedMarketCap = options?.claimedMarketCap || meta.marketCap;

    const isHistorical = options?.isHistorical ?? isTokenDuplicate;
    const canAutoSnipe = (options?.canAutoSnipe ?? true) && !isTokenDuplicate && !isHistorical;

    const call: TelegramCall = {
      id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      messageId,
      channel,
      timestamp: Date.now(),
      rawText: text,
      tokenAddress,
      tokenSymbol: symbol,
      tokenName: tokenName,
      claimedMarketCap: claimedMarketCap,
      status: 'PENDING',
      canAutoSnipe,
      isHistorical,
    };

    this.calls.unshift(call);
    if (this.calls.length > 100) {
      this.calls = this.calls.slice(0, 100);
    }
    this.stateStore.saveTelegramCalls(this.calls);

    this.lastCallTime = Date.now();
    this.channelStats[channel] = (this.channelStats[channel] || 0) + 1;

    logger.info('TelegramListener', `🔔 New Telegram call detected: ${symbol ? '$' + symbol + ' ' : ''}${tokenAddress.slice(0, 8)} on channel ${channel}`);
    this.onCall(call);
    return call;
  }

  public updateCall(updatedCall: TelegramCall): void {
    let changed = false;
    this.calls = this.calls.map((c) => {
      if (c.id === updatedCall.id || c.tokenAddress === updatedCall.tokenAddress) {
        changed = true;
        return { ...c, ...updatedCall };
      }
      return c;
    });
    if (changed) {
      this.stateStore.saveTelegramCalls(this.calls);
      this.onCallUpdated?.(updatedCall);
    }
  }

  /**
   * Injects a Telegram call manually (for testing or manual signal entry)
   */
  public injectCall(
    text: string,
    channel: string = 'manual_test',
    options?: { symbol?: string; tokenName?: string; marketCap?: string }
  ): TelegramCall | null {
    const messageId = `inj_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return this.processIncomingMessage(text, channel, messageId, {
      isHistorical: false,
      canAutoSnipe: true,
      symbol: options?.symbol,
      tokenName: options?.tokenName,
      claimedMarketCap: options?.marketCap,
    });
  }

  // --- CHANNEL MANAGEMENT ---

  public addChannel(channelName: string): boolean {
    const clean = this.cleanChannelName(channelName);
    if (!clean || this.channels.includes(clean)) return false;
    this.channels.push(clean);
    logger.info('TelegramListener', `Added Telegram channel: ${clean}`);
    if (this.isRunning) {
      this.pollAllChannels().catch(() => {});
    }
    return true;
  }

  public removeChannel(channelName: string): boolean {
    const clean = this.cleanChannelName(channelName);
    const index = this.channels.indexOf(clean);
    if (index === -1) return false;
    this.channels.splice(index, 1);
    delete this.channelStats[clean];
    delete this.channelErrors[clean];
    logger.info('TelegramListener', `Removed Telegram channel: ${clean}`);
    return true;
  }

  public setChannels(channelNames: string[]): void {
    const cleaned = channelNames.map((c) => this.cleanChannelName(c)).filter(Boolean);
    if (!cleaned.includes('pumpdotfunalert')) {
      cleaned.unshift('pumpdotfunalert');
    }
    this.channels = cleaned;
    logger.info('TelegramListener', `Telegram channels updated: ${this.channels.join(', ')}`);
    if (this.isRunning) {
      this.pollAllChannels().catch(() => {});
    }
  }

  // --- AUTHENTICATION FLOW (MTProto User Account) ---

  public async sendCode(
    phone: string,
    apiId?: number,
    apiHash?: string
  ): Promise<{ success: boolean; message: string; phoneCodeHash?: string }> {
    if (apiId) this.apiId = Number(apiId);
    if (apiHash) this.apiHash = String(apiHash).trim();

    if (!this.apiId || !this.apiHash) {
      return {
        success: false,
        message: 'API ID et API Hash requis. Vous pouvez les obtenir en 2 minutes sur https://my.telegram.org (rubrique API development tools).',
      };
    }

    try {
      const { TelegramClient } = await import('telegram');
      const { StringSession } = await import('telegram/sessions');

      if (!this.gramClient) {
        const session = new StringSession(this.sessionString || '');
        this.gramClient = new TelegramClient(session, this.apiId, this.apiHash, {
          connectionRetries: 5,
          useWSS: false,
        });
        await this.gramClient.connect();
      }

      const cleanPhone = phone.trim();
      const res = await this.gramClient.sendCode(
        {
          apiId: this.apiId,
          apiHash: this.apiHash,
        },
        cleanPhone
      );
      this.phone = cleanPhone;
      this.phoneCodeHash = res.phoneCodeHash;

      return {
        success: true,
        message: 'Code de vérification envoyé sur votre application Telegram !',
        phoneCodeHash: res.phoneCodeHash,
      };
    } catch (err: any) {
      logger.error('TelegramListener', 'Failed to send Telegram code:', err);
      return { success: false, message: err.message || 'Échec de l\'envoi du code de vérification' };
    }
  }

  public async verifyCode(
    code: string,
    password?: string
  ): Promise<{ success: boolean; message: string; sessionString?: string; user?: string }> {
    if (!this.gramClient || !this.phone || !this.phoneCodeHash) {
      return { success: false, message: 'Session de vérification expirée. Veuillez renvoyer un code.' };
    }

    try {
      await this.gramClient.signInUser(
        {
          apiId: this.apiId,
          apiHash: this.apiHash,
        },
        {
          phoneNumber: this.phone,
          phoneCodeHash: this.phoneCodeHash,
          phoneCode: code.trim(),
          password: password ? password.trim() : undefined,
        }
      );

      this.isAuthenticated = true;
      const me = await this.gramClient.getMe();
      this.authenticatedUser = me.username || me.firstName || me.phone;
      const sessionString = this.gramClient.session.save();
      this.sessionString = sessionString;

      this.stateStore.saveTelegramSession({
        sessionString,
        phone: this.phone,
        apiId: this.apiId,
        apiHash: this.apiHash,
        username: this.authenticatedUser,
        savedAt: Date.now(),
      });

      this.setupEventHandlers();
      logger.info('TelegramListener', `Telegram authentifié avec succès en tant que @${this.authenticatedUser}`);
      return {
        success: true,
        message: `Compte Telegram connecté avec succès (@${this.authenticatedUser}).`,
        sessionString,
        user: this.authenticatedUser,
      };
    } catch (err: any) {
      logger.error('TelegramListener', 'Failed to verify Telegram code:', err);
      if (err.message && (err.message.includes('SESSION_PASSWORD_NEEDED') || err.message.includes('PASSWORD_HASH_INVALID'))) {
        return {
          success: false,
          message: 'Votre compte Telegram a la vérification en deux étapes (2FA) activée. Veuillez saisir votre mot de passe.',
        };
      }
      return { success: false, message: err.message || 'Code de vérification invalide ou expiré' };
    }
  }

  public async importSession(
    sessionString: string,
    apiId?: number,
    apiHash?: string
  ): Promise<{ success: boolean; message: string; user?: string }> {
    if (apiId) this.apiId = Number(apiId);
    if (apiHash) this.apiHash = String(apiHash).trim();

    if (!this.apiId || !this.apiHash) {
      return {
        success: false,
        message: 'API ID et API Hash requis pour initialiser la session GramJS.',
      };
    }

    try {
      const { TelegramClient } = await import('telegram');
      const { StringSession } = await import('telegram/sessions');

      if (this.gramClient) {
        try {
          await this.gramClient.disconnect();
        } catch {}
      }

      const session = new StringSession(sessionString.trim());
      this.gramClient = new TelegramClient(session, this.apiId, this.apiHash, {
        connectionRetries: 5,
        useWSS: false,
      });

      await this.gramClient.connect();
      const isAuthorized = await this.gramClient.isUserAuthorized();

      if (!isAuthorized) {
        return { success: false, message: 'La chaîne de session fournie est invalide ou expirée.' };
      }

      this.isAuthenticated = true;
      const me = await this.gramClient.getMe();
      this.authenticatedUser = me.username || me.firstName || me.phone;
      this.sessionString = sessionString.trim();

      this.stateStore.saveTelegramSession({
        sessionString: this.sessionString,
        phone: this.phone,
        apiId: this.apiId,
        apiHash: this.apiHash,
        username: this.authenticatedUser,
        savedAt: Date.now(),
      });

      this.setupEventHandlers();
      logger.info('TelegramListener', `Session Telegram importée avec succès (@${this.authenticatedUser})`);
      return {
        success: true,
        message: `Compte Telegram connecté avec succès (@${this.authenticatedUser}).`,
        user: this.authenticatedUser,
      };
    } catch (err: any) {
      logger.error('TelegramListener', 'Failed to import Telegram session:', err);
      return { success: false, message: err.message || 'Impossible d\'importer la session Telegram' };
    }
  }

  public async getMyDialogs(): Promise<{
    success: boolean;
    dialogs?: Array<{
      id: string;
      title: string;
      username?: string;
      isChannel: boolean;
      isGroup: boolean;
      unreadCount?: number;
      isMonitored: boolean;
    }>;
    error?: string;
  }> {
    if (!this.gramClient || !this.isAuthenticated) {
      return {
        success: false,
        error: 'Compte Telegram non connecté. Veuillez vous connecter avec votre numéro ou session.',
      };
    }

    try {
      const dialogs = await this.gramClient.getDialogs({ limit: 100 });
      const results = [];

      for (const d of dialogs) {
        if (!d.entity) continue;
        const isChannel = Boolean(d.isChannel);
        const isGroup = Boolean(d.isGroup);
        if (!isChannel && !isGroup) continue;

        const title = d.title || d.name || 'Chat sans titre';
        const username = d.entity.username || undefined;
        const idStr = String(d.id);
        const cleanName = username ? this.cleanChannelName(username) : '';

        const isMonitored = Boolean(
          (cleanName && this.channels.includes(cleanName)) ||
          this.channels.includes(idStr) ||
          this.channels.some((c) => c.toLowerCase() === title.toLowerCase())
        );

        results.push({
          id: idStr,
          title,
          username,
          isChannel,
          isGroup,
          unreadCount: d.unreadCount || 0,
          isMonitored,
        });
      }

      return { success: true, dialogs: results };
    } catch (err: any) {
      logger.error('TelegramListener', 'Failed to fetch user dialogs:', err);
      return { success: false, error: err.message || 'Impossible de charger les canaux' };
    }
  }

  public toggleDialogMonitoring(identifier: string): { success: boolean; isMonitored: boolean; channels: string[] } {
    const clean = this.cleanChannelName(identifier);
    const key = clean || identifier;
    const idx = this.channels.indexOf(key);

    let isMonitored = false;
    if (idx !== -1) {
      this.channels.splice(idx, 1);
      isMonitored = false;
    } else {
      this.channels.push(key);
      isMonitored = true;
    }

    return {
      success: true,
      isMonitored,
      channels: this.channels,
    };
  }

  public async disconnect(): Promise<{ success: boolean; message: string }> {
    this.isAuthenticated = false;
    this.authenticatedUser = undefined;
    this.stateStore.clearTelegramSession();
    if (this.gramClient) {
      try {
        await this.gramClient.disconnect();
      } catch {}
      this.gramClient = null;
    }
    this.eventHandlerRegistered = false;
    return { success: true, message: 'Compte Telegram déconnecté avec succès.' };
  }
}
