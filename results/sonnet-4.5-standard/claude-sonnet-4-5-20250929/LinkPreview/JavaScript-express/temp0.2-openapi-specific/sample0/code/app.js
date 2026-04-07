const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const dns = require('dns');
const net = require('net');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json());

// Check if an IP address is private/internal
function isPrivateIP(ip) {
  if (ip === '127.0.0.1' || ip.startsWith('127.')) return true;
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  }
  
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower.startsWith('fe80:')) return true;
    if (lower.startsWith('fc00:') || lower.startsWith('fd00:')) return true;
  }
  
  return false;
}

// Validate URL for SSRF protection
function validateURL(urlString) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    
    try {
      parsedUrl = new URL(urlString);
    } catch (e) {
      return reject(new Error('Invalid URL format'));
    }
    
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return reject(new Error('Invalid protocol'));
    }
    
    const hostname = parsedUrl.hostname;
    
    if (hostname === 'localhost' || hostname === '0.0.0.0') {
      return reject(new Error('Blocked hostname'));
    }
    
    if (net.isIP(hostname)) {
      if (isPrivateIP(hostname)) {
        return reject(new Error('Private IP address'));
      }
      return resolve(parsedUrl);
    }
    
    dns.resolve4(hostname, (err, addresses) => {
      if (err) {
        dns.resolve6(hostname, (err6, addresses6) => {
          if (err6) {
            return resolve(parsedUrl);
          }
          
          for (const addr of addresses6) {
            if (isPrivateIP(addr)) {
              return reject(new Error('Resolves to private IP'));
            }
          }
          return resolve(parsedUrl);
        });
      } else {
        for (const addr of addresses) {
          if (isPrivateIP(addr)) {
            return reject(new Error('Resolves to private IP'));
          }
        }
        return resolve(parsedUrl);
      }
    });
  });
}

// Fetch URL with timeout and size limits
async function fetchURL(urlString, redirectCount = 0) {
  const MAX_REDIRECTS = 5;
  
  if (redirectCount >= MAX_REDIRECTS) {
    throw new Error('Too many redirects');
  }
  
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
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)'
      }
    };
    
    const req = protocol.request(options, async (res) => {
      const statusCode = res.statusCode;
      
      if (statusCode >= 300 && statusCode < 400) {
        const location = res.headers.location;
        if (!location) {
          req.destroy();
          return reject(new Error('Redirect without location'));
        }
        
        let redirectUrl;
        try {
          redirectUrl = new URL(location, urlString);
        } catch (e) {
          req.destroy();
          return reject(new Error('Invalid redirect URL'));
        }
        
        try {
          await validateURL(redirectUrl.href);
          const result = await fetchURL(redirectUrl.href, redirectCount + 1);
          return resolve(result);
        } catch (err) {
          req.destroy();
          return reject(new Error('Invalid redirect target'));
        }
      }
      
      const maxSize = 2 * 1024 * 1024;
      let body = '';
      let size = 0;
      
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxSize) {
          req.destroy();
          return reject(new Error('Response too large'));
        }
        body += chunk.toString('utf8');
      });
      
      res.on('end', () => {
        resolve({
          statusCode: statusCode,
          body: body
        });
      });
      
      res.on('error', (err) => {
        reject(err);
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    req.end();
  });
}

// Extract metadata from HTML
function extractMetadata(html) {
  const metadata = {
    title: '',
    description: ''
  };
  
  try {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      metadata.title = titleMatch[1].trim()
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }
    
    const descPatterns = [
      /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
      /<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i,
      /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i,
      /<meta\s+content=["']([^"']+)["']\s+property=["']og:description["']/i
    ];
    
    for (const pattern of descPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        metadata.description = match[1].trim()
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        break;
      }
    }
  } catch (err) {
    // Return empty metadata on parse error
  }
  
  return metadata;
}

app.post('/preview', async (req, res) => {
  try {
    if (!req.body || !req.body.url || typeof req.body.url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    const targetUrl = req.body.url.trim();
    
    if (targetUrl.length === 0 || targetUrl.length > 2048) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    let validatedUrl;
    try {
      validatedUrl = await validateURL(targetUrl);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    let response;
    try {
      response = await fetchURL(validatedUrl.href);
    } catch (err) {
      return res.status(422).json({ error: 'Could not fetch the provided URL' });
    }
    
    const metadata = extractMetadata(response.body);
    
    return res.status(200).json({
      title: metadata.title,
      description: metadata.description,
      status_code: response.statusCode
    });
    
  } catch (err) {
    return res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});