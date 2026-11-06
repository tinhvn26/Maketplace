import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RateLimitStore } from '../../../application/ports/rate-limit-store.js';
import { IdentityRateLimit } from '../decorators/identity-rate-limit.decorator.js';
import { IdentityRateLimitGuard } from './identity-rate-limit.guard.js';

@IdentityRateLimit({ scope: 'identity.auth', limit: 120, windowMs: 60_000 })
class OriginalController {
  @IdentityRateLimit({ scope: 'login', limit: 10 })
  login() {}

  @IdentityRateLimit({ scope: 'register', limit: 5 })
  register() {}

  newlyAddedEndpoint() {}
}

@IdentityRateLimit({ scope: 'identity.auth', limit: 120, windowMs: 60_000 })
class RenamedController {
  @IdentityRateLimit({ scope: 'login', limit: 10 })
  renamedLogin() {}
}

function setup(
  controller: new () => object = OriginalController,
  method = 'login',
) {
  const consume = vi.fn<RateLimitStore['consume']>().mockResolvedValue({
    count: 1,
    resetAt: Date.now() + 60_000,
  });
  const setHeader = vi.fn();
  const request = {
    ip: '192.0.2.10',
    socket: { remoteAddress: '192.0.2.11' },
    headers: { 'x-forwarded-for': '198.51.100.10' },
  };
  const context = {
    getClass: () => controller,
    getHandler: () =>
      (controller.prototype as unknown as Record<string, () => void>)[method],
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  return {
    guard: new IdentityRateLimitGuard({ consume }, new Reflector()),
    consume,
    setHeader,
    request,
    context,
  };
}

describe('IdentityRateLimitGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retains the same policy and bucket after controller and method renames', async () => {
    const original = setup();
    const renamed = setup(RenamedController, 'renamedLogin');

    await expect(original.guard.canActivate(original.context)).resolves.toBe(
      true,
    );
    await expect(renamed.guard.canActivate(renamed.context)).resolves.toBe(
      true,
    );

    expect(original.consume.mock.calls[0][0]).toMatchObject({
      limit: 10,
      windowMs: 60_000,
    });
    expect(renamed.consume.mock.calls[0][0].key).toBe(
      original.consume.mock.calls[0][0].key,
    );
    expect(renamed.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('keeps endpoint buckets independent while inheriting controller defaults', async () => {
    const login = setup();
    const register = setup(OriginalController, 'register');
    const fallback = setup(OriginalController, 'newlyAddedEndpoint');
    await login.guard.canActivate(login.context);
    await register.guard.canActivate(register.context);
    await fallback.guard.canActivate(fallback.context);

    expect(login.consume.mock.calls[0][0].key).not.toBe(
      register.consume.mock.calls[0][0].key,
    );
    expect(register.consume.mock.calls[0][0]).toMatchObject({
      limit: 5,
      windowMs: 60_000,
    });
    expect(fallback.consume).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 120, windowMs: 60_000 }),
    );
  });

  it('returns 429 with rounded Retry-After and no-store after the limit', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const fixture = setup();
    fixture.consume.mockResolvedValue({ count: 11, resetAt: 61_001 });

    await expect(
      fixture.guard.canActivate(fixture.context),
    ).rejects.toMatchObject({
      status: 429,
    });
    expect(fixture.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(fixture.setHeader).toHaveBeenCalledWith('Retry-After', 61);
  });

  it('does not use a spoofed forwarding header as the client address', async () => {
    const first = setup();
    const spoofed = setup();
    spoofed.request.headers['x-forwarded-for'] = '203.0.113.99';
    await first.guard.canActivate(first.context);
    await spoofed.guard.canActivate(spoofed.context);
    expect(first.consume.mock.calls[0][0].key).toBe(
      spoofed.consume.mock.calls[0][0].key,
    );
  });

  it('leaves controllers without identity rate-limit metadata outside its scope', async () => {
    class OtherController {
      read() {}
    }
    const fixture = setup(OtherController, 'read');
    await expect(fixture.guard.canActivate(fixture.context)).resolves.toBe(
      true,
    );
    expect(fixture.consume).not.toHaveBeenCalled();
    expect(fixture.setHeader).not.toHaveBeenCalled();
  });
});
