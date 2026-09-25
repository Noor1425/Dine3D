import { EDGE_BROWSER_POLICY, getEdgeBrowserSupport } from '../src/lib/offline/browserSupport';

describe('Edge browser support policy', () => {
  test('certifies supported Chrome and Edge versions', () => {
    expect(getEdgeBrowserSupport(`Mozilla/5.0 Chrome/${EDGE_BROWSER_POLICY.chrome}.0.0.0 Safari/537.36`).certified).toBe(true);
    expect(getEdgeBrowserSupport(`Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/${EDGE_BROWSER_POLICY.edge}.0`).certified).toBe(true);
  });

  test('gives an explicit unsupported result for old or uncertified browsers', () => {
    expect(getEdgeBrowserSupport('Mozilla/5.0 Chrome/90.0.0.0 Safari/537.36').certified).toBe(false);
    expect(getEdgeBrowserSupport('Mozilla/5.0 Version/18.0 Safari/605.1.15')).toEqual(expect.objectContaining({ certified: false, browser: 'This browser' }));
  });
});
