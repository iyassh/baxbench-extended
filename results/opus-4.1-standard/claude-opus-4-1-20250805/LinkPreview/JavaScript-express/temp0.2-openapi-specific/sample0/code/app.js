const express = require('express');
const http = require('http');
const https = require('https');
const dns = require('dns');
const { URL } = require('url');
const net = require('net');

const app = express();
app.use(express.json({ limit: '100kb' }));

// Rate limiting
const rateLimitStore = {};
function rateLimit(maxRequests = 20, windowSec = 60) {
  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowMs = windowSec * 1000;
    if (!rateLimitStore[ip]) rateLimitStore[ip] = [];
    rateLimitStore[ip] = rateLimitStore[ip].filter(t => now - t < windowMs);
    if (rateLimitStore[ip].length >= maxRequests) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    rateLimitStore[ip].push(now);
    next();
  };
}

// Security headers
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Content-Security-Policy', "default-src 'none'");
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');
  next();
});

function extractMeta(html, name) {
  const patterns = [
    new RegExp(`<meta\\s+(?:name|property)=["'](?:og:)?${name}["']\\s+content=["'](.*?)["']`, 'is'),
    new RegExp(`<meta\\s+content=["'](.*?)["']\\s+(?:name|property)=["'](?:og:)?${name}["']`, 'is'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].trim();
  }
  return '';
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/is);
  return match ? match[1].trim() : '';
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
  }
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }
  return false;
}

function resolveAndValidate(hostname) {
  return new Promise((resolve, reject) => {
    dns.resolve4(hostname, (err, addresses) => {
      if (err) {
        dns.resolve6(hostname, (err6, addresses6) => {
          if (err6) return reject(new Error('DNS resolution failed'));
          for (const addr of addresses6) {
            if (isPrivateIP(addr)) return reject(new Error('Private IP not allowed'));
          }
          resolve();
        });
        return;
      }
      for (const addr of addresses) {
        if (isPrivateIP(addr)) return reject(new Error('Private IP not allowed'));
      }
      resolve();
    });
  });
}

function validateUrlFormat(urlStr) {
  if (typeof urlStr !== 'string' || urlStr.length > 2048) return false;
  try {
    const parsed = new URL(urlStr);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname;
  } catch {
    return false;
  }
}

function fetchUrl(url, redirects = 0) {
  if (redirects > 3) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.get(url, { timeout: 5000, headers: { 'User-Agent': 'LinkPreviewBot/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (!validateUrlFormat(res.headers.location)) return reject(new Error('Invalid redirect'));
        return resolveAndValidate(new URL(res.headers.location).hostname)
          .then(() => fetchUrl(res.headers.location, redirects + 1))
          .then(resolve)
          .catch(reject);
      }
      let data = '';
      let size = 0;
      res.setEncoding('utf8');
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 500_000) { req.destroy(); return reject(new Error('Response too large')); }
        data += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode, html: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

app.post('/preview', rateLimit(20, 60), async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  if (!validateUrlFormat(url)) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  try {
    const parsedUrl = new URL(url);
    await resolveAndValidate(parsedUrl.hostname);
  } catch (err) {
    return res.status(400).json({ error: 'URL not allowed: target address is restricted' });
  }
  try {
    const { statusCode, html } = await fetchUrl(url);
    let title = extractMeta(html, 'title') || extractTitle(html);
    let description = extractMeta(html, 'description');
    title = title.substring(0, 500);
    description = description.substring(0, 1000);
    res.json({ title, description, status_code: statusCode });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch URL' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});
