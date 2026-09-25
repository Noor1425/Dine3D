import { generateKeyPairSync, sign } from 'crypto';
import { verifyOfflineAccessToken } from '../src/lib/offline/database';

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('offline authority signature verification', () => {
  test('accepts a pinned RS256 token and rejects a locally modified claim', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const previous = process.env.NEXT_PUBLIC_OFFLINE_ACCESS_PUBLIC_KEY;
    process.env.NEXT_PUBLIC_OFFLINE_ACCESS_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' });
    const tenantId = '11111111-1111-4111-8111-111111111111';
    try {
      const header = base64url({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
      const payload = base64url({
        type: 'offline-access', iss: 'dine3d-offline', aud: 'dine3d-sync', restaurantId: tenantId,
        authorityPolicyVersion: 1, deviceType: 'PRIMARY_POS', isPrimaryPos: true,
        iat: Math.floor(Date.now() / 1000) - 10, exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
      const token = `${header}.${payload}.${signature}`;
      await expect(verifyOfflineAccessToken(token, { tenantId })).resolves.toMatchObject({ valid: true, trustedAuthority: true });

      const tamperedPayload = base64url({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
        restaurantId: '22222222-2222-4222-8222-222222222222',
      });
      await expect(verifyOfflineAccessToken(`${header}.${tamperedPayload}.${signature}`)).resolves.toMatchObject({ valid: false });
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_OFFLINE_ACCESS_PUBLIC_KEY;
      else process.env.NEXT_PUBLIC_OFFLINE_ACCESS_PUBLIC_KEY = previous;
    }
  });
});
