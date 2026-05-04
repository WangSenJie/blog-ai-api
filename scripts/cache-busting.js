'use strict';

const crypto = require('crypto');

function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    stream.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', reject);
  });
}

async function readRouteBuffer(route, routePath) {
  const stream = route.get(routePath);
  if (!stream) return null;
  return readStream(stream);
}

function getRoutePath(assetUrl) {
  const normalized = assetUrl.split('#')[0].split('?')[0];
  if (!normalized.startsWith('/')) return null;
  return normalized.replace(/^\/+/, '');
}

function appendVersion(url, version) {
  if (!version) return url;
  if (/[?&]v=/.test(url)) return url;

  const [base, hash = ''] = url.split('#');
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}v=${version}${hash ? `#${hash}` : ''}`;
}

hexo.extend.filter.register('after_generate', async () => {
  const { route } = hexo;
  const versionCache = new Map();
  const htmlRoutes = route.list().filter(path => path.endsWith('.html'));

  async function getFileVersion(routePath) {
    if (versionCache.has(routePath)) return versionCache.get(routePath);

    const content = await readRouteBuffer(route, routePath);
    if (!content) return null;

    const version = crypto.createHash('sha1').update(content).digest('hex').slice(0, 8);
    versionCache.set(routePath, version);
    return version;
  }

  for (const htmlRoute of htmlRoutes) {
    const htmlBuffer = await readRouteBuffer(route, htmlRoute);
    if (!htmlBuffer) continue;

    const original = htmlBuffer.toString('utf8');
    const matches = [...original.matchAll(/\b(?:href|src)=["'](\/[^"']+\.(?:css|js))["']/g)];

    if (!matches.length) continue;

    let updated = original;

    for (const match of matches) {
      const assetUrl = match[1];
      const assetRoute = getRoutePath(assetUrl);
      const version = assetRoute ? await getFileVersion(assetRoute) : null;
      if (!version) continue;

      updated = updated.replace(assetUrl, appendVersion(assetUrl, version));
    }

    if (updated !== original) {
      route.set(htmlRoute, updated);
    }
  }
});
