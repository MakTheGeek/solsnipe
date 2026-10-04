import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { SecurityManager } from '../../server/securityManager';
import { StateStore } from '../../server/persistence/stateStore';

describe('Integration Tests: Backend Security & Authentication Middleware', () => {
  const stateStore = new StateStore('/tmp/solsnipe_test_runtime_' + Date.now());
  const security = new SecurityManager(stateStore);

  test('Requires at least 4 characters for security PIN/code', () => {
    const res = security.setupCode({ newCode: '12' });
    assert.strictEqual(res.success, false);
    assert.ok(res.message.includes('4 caractères') || res.message.includes('at least 4 characters'));
  });

  test('Sets up and verifies authentication code successfully', () => {
    const setupRes = security.setupCode({ newCode: 'SecretCode123', autoLockMinutes: 15 });
    assert.strictEqual(setupRes.success, true);
    assert.ok(setupRes.token);

    const status = security.getStatus();
    assert.strictEqual(status.enabled, true);
    assert.strictEqual(status.hasCodeSet, true);

    // Verify valid code
    const verifyValid = security.verifyCode('SecretCode123');
    assert.strictEqual(verifyValid.success, true);
    assert.ok(verifyValid.token);
    assert.strictEqual(security.isTokenValid(verifyValid.token), true);

    // Verify invalid code
    const verifyWrong = security.verifyCode('WrongCode999');
    assert.strictEqual(verifyWrong.success, false);
  });

  test('Enforces brute-force lockout after 5 consecutive failed attempts', () => {
    // 5 failed attempts
    for (let i = 0; i < 4; i++) {
      const res = security.verifyCode('BadAttempt');
      assert.strictEqual(res.success, false);
    }
    const lockedRes = security.verifyCode('BadAttempt5');
    assert.strictEqual(lockedRes.success, false);
    assert.ok(lockedRes.message.includes('30'));

    // Even correct code is blocked while lockout active
    const correctDuringLockout = security.verifyCode('SecretCode123');
    assert.strictEqual(correctDuringLockout.success, false);
    assert.ok(correctDuringLockout.message.includes('Trop de tentatives') || correctDuringLockout.message.includes('Too many failed attempts'));
  });

  test('Validates Express requireAuth middleware functionality', () => {
    const freshState = new StateStore('/tmp/solsnipe_fresh_test_' + Date.now());
    const secManager = new SecurityManager(freshState);
    secManager.setupCode({ newCode: 'ValidPass123' });

    let nextCalled = false;
    const mockNext = () => {
      nextCalled = true;
    };

    let statusCode = 0;
    let jsonBody: any = null;
    const mockRes: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonBody = data;
        return this;
      },
    };

    // Unauthenticated request
    const unauthReq: any = { headers: {}, cookies: {} };
    secManager.requireAuth(unauthReq, mockRes, mockNext);
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(statusCode, 401);
    assert.strictEqual(jsonBody?.error?.code, 'UNAUTHORIZED');

    // Authenticated request with valid token
    const token = secManager.verifyCode('ValidPass123').token;
    const authReq: any = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
    nextCalled = false;
    secManager.requireAuth(authReq, mockRes, mockNext);
    assert.strictEqual(nextCalled, true);
  });

  test('Blocks access with 403 SECURITY_SETUP_REQUIRED when no code has been initialized', () => {
    const unconfiguredStore = new StateStore('/tmp/solsnipe_unconfigured_test_' + Date.now());
    const unconfiguredSec = new SecurityManager(unconfiguredStore);

    let nextCalled = false;
    let statusCode = 0;
    let jsonBody: any = null;
    const mockRes: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonBody = data;
        return this;
      },
    };

    const req: any = { headers: {}, cookies: {} };
    unconfiguredSec.requireAuth(req, mockRes, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(jsonBody?.error?.code, 'SECURITY_SETUP_REQUIRED');
  });
});
