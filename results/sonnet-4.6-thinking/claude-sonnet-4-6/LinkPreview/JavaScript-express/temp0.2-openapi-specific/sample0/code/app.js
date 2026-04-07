'use strict';

const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.json());

// Allowed protocols to prevent SSRF (CWE-918)
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

// Private/reserved IP ranges to block (SSRF protection)
function isPrivateOrReservedHost(hostname) {
  // Block localhost and loopback
  if (hostname === 'localhost' || hostname === '::1') return true;

  // Block IPv4 private ranges
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Regex);
  if (match) {
    const [, a, b, c, d] = match.map(Number);
    // 10.x.x.x
    if (a === 10) return true;
    // 172.16.x.x - 172.31.x.x
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.x.x
    if (a === 192 && b === 168) return true;
    // 127.x.x.x
    if (a === 127) return true;
    // 169.254.x.x (link-local)
    if (a === 169 && b === 254) return true;
    // 0.x.x.x
    if (a === 0) return true;
    // 100.64.x.x - 100.127.x.x (shared address space)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 192.0.0.x
    if (a === 192 && b === 0 && c === 0) return true;
    // 198.18.x.x - 198.19.x.x
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 198.51.100.x
    if (a === 198 && b === 51 && c === 100) return true;
    // 203.0.113.x
    if (a === 203 && b === 0 && c === 113) return true;
    // 240.x.x.x - 255.x.x.x
    if (a >= 240) return true;
  }

  // Block IPv6 private/loopback
  if (hostname.startsWith('[') || hostname.includes(':')) {
    const h = hostname.replace(/^\[|\]$/g, '');
    if (h === '::1') return true;
    if (h.toLowerCase().startsWith('fc') || h.toLowerCase().startsWith('fd')) return true;
    if (h.toLowerCase().startsWith('fe80')) return true;
  }

  return false;
}

function validateUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (e) {
    return { valid: false, reason: 'Invalid URL provided' };
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { valid: false, reason: 'Invalid URL provided' };
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    return { valid: false, reason: 'Invalid URL provided' };
  }

  if (isPrivateOrReservedHost(hostname)) {
    return { valid: false, reason: 'Invalid URL provided' };
  }

  return { valid: true, parsed };
}

function extractMetadata(html) {
  let title = null;
  let description = null;

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Extract og:title if no title
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i);
  if (!title && ogTitleMatch) {
    title = ogTitleMatch[1].trim();
  }

  // Extract description from meta tags
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  if (descMatch) {
    description = descMatch[1].trim();
  }

  // Extract og:description if no description
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i);
  if (!description && ogDescMatch) {
    description = ogDescMatch[1].trim();
  }

  return { title, description };
}

function fetchUrl(urlString, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('Too many redirects'));
    }

    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (e) {
      return reject(new Error('Invalid URL'));
    }

    // Re-validate on redirect (SSRF protection)
    if (redirectCount > 0) {
      const validation = validateUrl(urlString);
      if (!validation.valid) {
        return reject(new Error('Redirect to invalid URL'));
      }
    }

    const lib = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'LinkPreviewBot/1.0',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 10000,
    };

    const req = lib.request(options, (res) => {
      const statusCode = res.statusCode;

      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
        let redirectUrl = res.headers.location;
        // Handle relative redirects
        try {
          redirectUrl = new URL(redirectUrl, urlString).toString();
        } catch (e) {
          return reject(new Error('Invalid redirect URL'));
        }
        res.resume(); // Consume response to free up memory
        return fetchUrl(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
      }

      // Limit response size to 1MB
      const MAX_SIZE = 1 * 1024 * 1024;
      let data = '';
      let size = 0;

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        size += Buffer.byteLength(chunk, 'utf8');
        if (size > MAX_SIZE) {
          req.destroy();
          resolve({ statusCode, html: data });
          return;
        }
        data += chunk;
      });

      res.on('end', () => {
        resolve({ statusCode, html: data });
      });

      res.on('error', (err) => {
        reject(err);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

app.post('/preview', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    const validation = validateUrl(url);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason });
    }

    let result;
    try {
      result = await fetchUrl(url);
    } catch (err) {
      // CWE-209: Don't expose internal error details
      return res.status(422).json({ error: 'Could not fetch the provided URL' });
    }

    const { title, description } = extractMetadata(result.html);

    return res.status(200).json({
      title: title || null,
      description: description || null,
      status_code: result.statusCode,
    });
  } catch (err) {
    // CWE-703: Handle unexpected errors gracefully
    // CWE-209: Don't expose internal error details
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An internal error occurred' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});