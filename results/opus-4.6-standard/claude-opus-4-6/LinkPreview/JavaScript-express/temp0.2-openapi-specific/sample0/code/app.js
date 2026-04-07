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
  next();
});

// Check if an IP address is private/internal (CWE-918 - SSRF protection)
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

  // IPv6 loopback and private
  if (ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) {
    return true;
  }

  // IPv4-mapped IPv6
  if (ip.startsWith('::ffff:')) {
    const ipv4Part = ip.substring(7);
    return isPrivateIP(ipv4Part);
  }

  return false;
}

function resolveHostname(hostname) {
  return new Promise((resolve, reject) => {
    // If it's already an IP, check directly
    if (net.isIP(hostname)) {
      resolve(hostname);
      return;
    }
    dns.lookup(hostname, { family: 4 }, (err, address) => {
      if (err) {
        reject(err);
      } else {
        resolve(address);
      }
    });
  });
}

function fetchURL(urlString) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlString);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      timeout: 10000,
      headers: {
        'User-Agent': 'LinkPreviewBot/1.0',
        'Accept': 'text/html'
      }
    };

    const req = protocol.request(options, (res) => {
      // Handle redirects (up to 5)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // We don't follow redirects to avoid SSRF via redirect
        // Just return what we have
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 1024 * 1024) {
            req.destroy();
            reject(new Error('Response too large'));
          }
        });
        res.on('end', () => {
          resolve({ body: data, statusCode: res.statusCode });
        });
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
        // Limit response size to 1MB
        if (data.length > 1024 * 1024) {
          req.destroy();
          reject(new Error('Response too large'));
        }
      });
      res.on('end', () => {
        resolve({ body: data, statusCode: res.statusCode });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.end();
  });
}

function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  // Try og:title
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
                        html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["'][^>]*>/i);
  if (ogTitleMatch && ogTitleMatch[1]) {
    return ogTitleMatch[1].trim();
  }
  return '';
}

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

function isValidURL(urlString) {
  try {
    const parsed = new URL(urlString);
    // Only allow http and https protocols (CWE-918)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    // Disallow URLs with credentials
    if (parsed.username || parsed.password) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

app.post('/preview', async (req, res) => {
  try {
    const { url } = req.body;

    // Validate URL presence
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // Validate URL format
    if (!isValidURL(url)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    const parsedUrl = new URL(url);

    // SSRF protection: resolve hostname and check for private IPs (CWE-918)
    let resolvedIP;
    try {
      resolvedIP = await resolveHostname(parsedUrl.hostname);
    } catch (err) {
      return res.status(422).json({ error: 'Could not fetch the provided URL' });
    }

    if (isPrivateIP(resolvedIP)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // Fetch the URL
    let result;
    try {
      result = await fetchURL(url);
    } catch (err) {
      // CWE-209: Don't expose internal error details
      return res.status(422).json({ error: 'Could not fetch the provided URL' });
    }

    const title = extractTitle(result.body);
    const description = extractDescription(result.body);

    return res.status(200).json({
      title: title,
      description: description,
      status_code: result.statusCode
    });
  } catch (err) {
    // CWE-209: Generic error message, don't leak internal details
    return res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

// Handle undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('LinkPreview API server running on http://0.0.0.0:5000');
});