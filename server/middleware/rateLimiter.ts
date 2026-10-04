import { NextFunction, Request, Response } from 'express';
import { logger } from '../logger';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
}

export function createRateLimiter(options: RateLimitConfig) {
  const requests = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - options.windowMs;

    let timestamps = requests.get(ip) || [];
    // Filter timestamps within window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= options.maxRequests) {
      logger.warn('RateLimiter', `Rate limit exceeded for IP ${ip} on ${req.method} ${req.path}`);
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: options.message || 'Too many requests. Please slow down.',
          retryAfterSeconds: Math.ceil((timestamps[0] + options.windowMs - now) / 1000),
        },
      });
      return;
    }

    timestamps.push(now);
    requests.set(ip, timestamps);

    // Periodically clean stale IPs
    if (requests.size > 1000) {
      for (const [key, times] of requests.entries()) {
        const valid = times.filter((t) => t > windowStart);
        if (valid.length === 0) {
          requests.delete(key);
        } else {
          requests.set(key, valid);
        }
      }
    }

    next();
  };
}
