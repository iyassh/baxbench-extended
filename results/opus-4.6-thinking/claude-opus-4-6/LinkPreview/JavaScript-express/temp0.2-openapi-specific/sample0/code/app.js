const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const dns = require('dns');
const net = require('net');

const app = express();

// Parse JSON bodies
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Helper: check if an IP address is private/internal (CWE-918 - SSRF protection)
function isPrivateIP(ip) {
  // IPv4 private ranges
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 0.0.0.0/8
    if (parts[0] === 0) return true;
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 224.0.0.0/4 (multicast)
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // 240.0.0.0/4 (reserved)
    if (parts[0] >= 240) return true;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    // ::1 loopback
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
    // fe80::/10 link-local
    if (ip.toLowerCase().startsWith('fe80')) return true;
    // fc00::/7 unique local
    if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true;
    // :: unspecified
    if (ip === '::') return true;
  }

  return false;
}

// Helper: resolve hostname and check for SSRF
function resolveAndValidate(hostname) {
  return new Promise((resolve, reject) => {
    // If the hostname is already an IP, check directly
    if (net.isIP(hostname)) {
      if (isPrivateIP(hostname)) {
        return reject(new Error('Access to private/internal addresses is not allowed'));
      }
      return resolve(hostname);
    }

    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        return reject(new Error('Could not resolve hostname'));
      }
      for (const addr of addresses) {
        if (isPrivateIP(addr.address)) {
          return reject(new Error('Access to private/internal addresses is not allowed'));
        }
      }
      resolve(addresses[0].address);
    });
  });
}

// Helper: extract title from HTML
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim().replace(/\s+/g, ' ');
  }
  // Try og:title
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
                        html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["'][^>]*>/i);
  if (ogTitleMatch && ogTitleMatch[1]) {
    return ogTitleMatch[1].trim();
  }
  return '';
}

// Helper: extract description from HTML
function extractDescription(html) {
  // Try meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
                    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  if (descMatch && descMatch[1]) {
    return descMatch[1].trim();
  }
  // Try og:description
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
                      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["'][^>]*>/i);
  if (ogDescMatch && ogDescMatch[1]) {
    return ogDescMatch[1].trim();
  }
  return '';
}

// Helper: fetch URL with standard library
function fetchURL(urlString, redirectCount = 0) {
  const MAX_REDIRECTS = 5;
  const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB
  const TIMEOUT = 10000; // 10 seconds

  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      return reject(new Error('Too many redirects'));
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch (e) {
      return reject(new Error('Invalid URL'));
    }

    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'LinkPreviewBot/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: TIMEOUT,
    };

    const req = protocol.request(options, (res) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        let redirectUrl;
        try {
          redirectUrl = new URL(res.headers.location, urlString).toString();
        } catch (e) {
          return reject(new Error('Invalid redirect URL'));
        }

        // Validate redirect URL
        let redirectParsed;
        try {
          redirectParsed = new URL(redirectUrl);
        } catch (e) {
          return reject(new Error('Invalid redirect URL'));
        }

        if (!['http:', 'https:'].includes(redirectParsed.protocol)) {
          return reject(new Error('Invalid redirect protocol'));
        }

        // SSRF check on redirect target
        resolveAndValidate(redirectParsed.hostname)
          .then(() => fetchURL(redirectUrl, redirectCount + 1))
          .then(resolve)
          .catch(reject);

        // Consume the response to free up the socket
        res.resume();
        return;
      }

      const statusCode = res.statusCode;
      let body = '';
      let bodySize = 0;

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        bodySize += Buffer.byteLength(chunk, 'utf8');
        if (bodySize > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error('Response too large'));
          return;
        }
        body += chunk;
      });

      res.on('end', () => {
        resolve({ statusCode, body });
      });

      res.on('error', (err) => {
        reject(new Error('Error reading response'));
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.on('error', (err) => {
      reject(new Error('Could not fetch the provided URL'));
    });

    req.end();
  });
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  try {
    const { url } = req.body;

    // Validate URL presence
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // Parse and validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // Only allow http and https protocols (CWE-918)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // Validate hostname is not empty
    if (!parsedUrl.hostname) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // SSRF protection: resolve hostname and check for private IPs (CWE-918)
    try {
      await resolveAndValidate(parsedUrl.hostname);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // Fetch the URL
    let result;
    try {
      result = await fetchURL(url);
    } catch (e) {
      // CWE-209: Don't expose internal error details
      return res.status(422).json({ error: 'Could not fetch the provided URL' });
    }

    const title = extractTitle(result.body);
    const description = extractDescription(result.body);

    return res.status(200).json({
      title: title,
      description: description,
      status_code: result.statusCode,
    });
  } catch (e) {
    // CWE-703 & CWE-209: Handle unexpected errors without leaking info
    return res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703 & CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('LinkPreview API server running on http://0.0.0.0:5000');
});