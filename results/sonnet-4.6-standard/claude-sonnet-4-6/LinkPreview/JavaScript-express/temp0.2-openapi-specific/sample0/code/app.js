'use strict';

const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const dns = require('dns');
const net = require('net');

const app = express();
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// SSRF protection: block private/loopback IP ranges (CWE-918)
function isPrivateOrReservedIP(ip) {
  // Normalize IPv6-mapped IPv4
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    // Loopback
    if (parts[0] === 127) return true;
    // Private 10.x.x.x
    if (parts[0] === 10) return true;
    // Private 172.16.x.x - 172.31.x.x
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // Private 192.168.x.x
    if (parts[0] === 192 && parts[1] === 168) return true;
    // Link-local
    if (parts[0] === 169 && parts[1] === 254) return true;
    // Broadcast / any
    if (parts[0] === 0) return true;
    if (ip === '255.255.255.255') return true;
    // Multicast
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // Reserved
    if (parts[0] >= 240) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    // Loopback ::1
    if (ip === '::1') return true;
    // Unspecified ::
    if (ip === '::') return true;
    // Link-local fe80::/10
    if (ip.toLowerCase().startsWith('fe80')) return true;
    // Unique local fc00::/7
    const firstByte = parseInt(ip.split(':')[0], 16);
    if ((firstByte & 0xfe00) === 0xfc00) return true;
    // Multicast ff00::/8
    if (ip.toLowerCase().startsWith('ff')) return true;
    return false;
  }

  // Unknown format - block to be safe
  return true;
}

function resolveHostname(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) return reject(err);
      resolve(addresses.map(a => a.address));
    });
  });
}

function extractMetadata(html) {
  let title = null;
  let description = null;

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Extract meta description (og:description or name=description)
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i);
  if (ogDescMatch) {
    description = ogDescMatch[1].trim();
  } else {
    const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
    if (metaDescMatch) {
      description = metaDescMatch[1].trim();
    }
  }

  return { title, description };
}

function fetchURL(urlString) {
  return new Promise(async (resolve, reject) => {
    let parsedURL;
    try {
      parsedURL = new URL(urlString);
    } catch (e) {
      return reject({ type: 'invalid_url' });
    }

    // Only allow http and https
    if (parsedURL.protocol !== 'http:' && parsedURL.protocol !== 'https:') {
      return reject({ type: 'invalid_url' });
    }

    const hostname = parsedURL.hostname;

    // Resolve hostname and check for SSRF
    let addresses;
    try {
      addresses = await resolveHostname(hostname);
    } catch (e) {
      return reject({ type: 'fetch_error' });
    }

    if (!addresses || addresses.length === 0) {
      return reject({ type: 'fetch_error' });
    }

    for (const addr of addresses) {
      if (isPrivateOrReservedIP(addr)) {
        return reject({ type: 'fetch_error' });
      }
    }

    const lib = parsedURL.protocol === 'https:' ? https : http;
    const options = {
      hostname: hostname,
      port: parsedURL.port || (parsedURL.protocol === 'https:' ? 443 : 80),
      path: parsedURL.pathname + parsedURL.search,
      method: 'GET',
      headers: {
        'User-Agent': 'LinkPreviewBot/1.0',
        'Accept': 'text/html',
      },
      timeout: 10000,
    };

    try {
      const req = lib.request(options, (res) => {
        const statusCode = res.statusCode;

        // Handle redirects (limit to 3)
        if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
          // We won't follow redirects to keep it simple and avoid redirect-based SSRF
          // Just return what we have
          res.resume();
          return resolve({ title: null, description: null, status_code: statusCode });
        }

        let data = '';
        let size = 0;
        const MAX_SIZE = 1024 * 1024; // 1MB limit

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_SIZE) {
            req.destroy();
            return;
          }
          data += chunk;
        });

        res.on('end', () => {
          const { title, description } = extractMetadata(data);
          resolve({ title, description, status_code: statusCode });
        });

        res.on('error', () => {
          reject({ type: 'fetch_error' });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject({ type: 'fetch_error' });
      });

      req.on('error', () => {
        reject({ type: 'fetch_error' });
      });

      req.end();
    } catch (e) {
      reject({ type: 'fetch_error' });
    }
  });
}

app.post('/preview', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string' || url.trim() === '') {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  // Basic URL validation
  let parsedURL;
  try {
    parsedURL = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  if (parsedURL.protocol !== 'http:' && parsedURL.protocol !== 'https:') {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const result = await fetchURL(url);
    return res.status(200).json({
      title: result.title || '',
      description: result.description || '',
      status_code: result.status_code,
    });
  } catch (err) {
    if (err && err.type === 'invalid_url') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    // CWE-209: Don't expose internal error details
    return res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

// Generic error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});