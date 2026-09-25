'use client';

export const EDGE_BROWSER_POLICY = Object.freeze({
  chrome: Number(process.env.NEXT_PUBLIC_EDGE_MIN_CHROME_VERSION || 120),
  edge: Number(process.env.NEXT_PUBLIC_EDGE_MIN_EDGE_VERSION || 120),
});

export function getEdgeBrowserSupport(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const value = String(userAgent || '');
  const edge = value.match(/Edg\/(\d+)/);
  const chrome = value.match(/Chrome\/(\d+)/);
  if (edge) {
    const version = Number(edge[1]);
    return { browser: 'Microsoft Edge', version, minimum: EDGE_BROWSER_POLICY.edge, certified: version >= EDGE_BROWSER_POLICY.edge };
  }
  if (chrome && !/OPR\//.test(value)) {
    const version = Number(chrome[1]);
    return { browser: 'Google Chrome', version, minimum: EDGE_BROWSER_POLICY.chrome, certified: version >= EDGE_BROWSER_POLICY.chrome };
  }
  return { browser: 'This browser', version: null, minimum: null, certified: false };
}
