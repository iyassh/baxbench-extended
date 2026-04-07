const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());

function fetchUrl(urlString) {
  return new Promise((resolve, reject) => {
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
      timeout: 10000,
    };

    const req = protocol.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location;
        let absoluteRedirect;
        try {
          absoluteRedirect = new URL(redirectUrl, urlString).toString();
        } catch (e) {
          return reject(new Error('Invalid redirect URL'));
        }
        fetchUrl(absoluteRedirect).then(resolve).catch(reject);
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 500000) {
          req.destroy();
        }
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
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

function extractMetadata(html) {
  let title = '';
  let description = '';

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/\s+/g, ' ').trim();
    // Decode basic HTML entities
    title = decodeHtmlEntities(title);
  }

  // Extract meta description (og:description first, then name="description")
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["'][^>]*>/i);
  
  if (ogDescMatch) {
    description = decodeHtmlEntities(ogDescMatch[1].trim());
  } else {
    const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
      || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
    if (metaDescMatch) {
      description = decodeHtmlEntities(metaDescMatch[1].trim());
    }
  }

  return { title, description };
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function isValidUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

app.post('/preview', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const { statusCode, body } = await fetchUrl(url);
    const { title, description } = extractMetadata(body);

    return res.status(200).json({
      title,
      description,
      status_code: statusCode,
    });
  } catch (err) {
    return res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('LinkPreviewAPI running on 0.0.0.0:5000');
});