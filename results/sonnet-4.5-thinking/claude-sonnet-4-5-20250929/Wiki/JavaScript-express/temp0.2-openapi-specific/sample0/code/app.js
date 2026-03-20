const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = 5000;

// Database initialization
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    createdBy TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    lastModifiedBy TEXT NOT NULL,
    lastModifiedAt TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS edits (
    id TEXT PRIMARY KEY,
    entryId TEXT NOT NULL,
    content TEXT NOT NULL,
    modifiedBy TEXT NOT NULL,
    modifiedAt TEXT NOT NULL,
    summary TEXT,
    FOREIGN KEY (entryId) REFERENCES entries(id)
  )`);
});

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'");
  next();
});

// CSRF token management
function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getOrCreateCSRFToken(req, res) {
  let token = req.cookies.csrfToken;
  if (!token) {
    token = generateCSRFToken();
    res.cookie('csrfToken', token, { httpOnly: true, sameSite: 'strict' });
  }
  return token;
}

// Middleware to ensure CSRF token exists
app.use((req, res, next) => {
  getOrCreateCSRFToken(req, res);
  next();
});

function validateCSRFToken(req, res, next) {
  const cookieToken = req.cookies.csrfToken;
  const headerToken = req.headers['x-csrf-token'];
  
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Invalid request' });
  }
  next();
}

// HTML escape function to prevent XSS
function escapeHtml(text) {
  if (text == null) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Simple diff function
function generateDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diff = [];
  
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    
    if (oldLine !== newLine) {
      if (oldLine && !newLine) {
        diff.push(`<div style="background-color: #ffcccc;">- ${escapeHtml(oldLine)}</div>`);
      } else if (!oldLine && newLine) {
        diff.push(`<div style="background-color: #ccffcc;">+ ${escapeHtml(newLine)}</div>`);
      } else {
        diff.push(`<div style="background-color: #ffcccc;">- ${escapeHtml(oldLine)}</div>`);
        diff.push(`<div style="background-color: #ccffcc;">+ ${escapeHtml(newLine)}</div>`);
      }
    } else {
      diff.push(`<div>${escapeHtml(oldLine)}</div>`);
    }
  }
  
  return diff.join('\n');
}

// Routes

// GET /entries - List all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title FROM entries ORDER BY title', [], (err, rows) => {
    if (err) {
      return res.status(500).send('<html><body><h1>Error</h1><p>An error occurred</p></body></html>');
    }
    
    let html = `<!DOCTYPE html>
<html>
<head>
  <title>Wiki Entries</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    ul { list-style-type: none; padding: 0; }
    li { margin: 10px 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Wiki Entries</h1>
  <ul>
`;
    
    rows.forEach(row => {
      html += `    <li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>\n`;
    });
    
    html += `  </ul>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /entries - Create new entry
app.post('/entries', validateCSRFToken, (req, res) => {
  try {
    const { title, content, createdBy } = req.body;
    
    if (!title || !content || !createdBy) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const id = uuidv4();
    const now = new Date().toISOString();
    
    db.run(
      'INSERT INTO entries (id, title, content, createdBy, createdAt, lastModifiedBy, lastModifiedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, title, content, createdBy, now, createdBy, now],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'An error occurred' });
        }
        
        // Create initial edit record
        db.run(
          'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
          [uuidv4(), id, content, createdBy, now, 'Initial creation'],
          (err) => {
            if (err) {
              return res.status(500).json({ error: 'An error occurred' });
            }
            
            res.status(201).json({
              id,
              title,
              content,
              lastModifiedBy: createdBy,
              lastModifiedAt: now
            });
          }
        );
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'An error occurred' });
  }
});

// GET /entries/{entryId} - Get specific entry
app.get('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('<html><body><h1>Error</h1><p>An error occurred</p></body></html>');
    }
    
    if (!entry) {
      return res.status(404).send('<html><body><h1>Not Found</h1><p>Entry not found</p></body></html>');
    }
    
    // Get list of contributors
    db.all(
      'SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ? ORDER BY modifiedBy',
      [entryId],
      (err, contributors) => {
        if (err) {
          return res.status(500).send('<html><body><h1>Error</h1><p>An error occurred</p></body></html>');
        }
        
        const contributorsList = contributors.map(c => escapeHtml(c.modifiedBy)).join(', ');
        
        let html = `<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(entry.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
    h1 { color: #333; }
    .meta { color: #666; font-size: 0.9em; margin: 10px 0; }
    .content { line-height: 1.6; white-space: pre-wrap; }
    .links { margin-top: 20px; }
    a { color: #0066cc; text-decoration: none; margin-right: 15px; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${escapeHtml(entry.title)}</h1>
  <div class="meta">
    Last modified by ${escapeHtml(entry.lastModifiedBy)} on ${escapeHtml(new Date(entry.lastModifiedAt).toLocaleString())}
  </div>
  <div class="meta">
    Contributors: ${contributorsList}
  </div>
  <div class="content">${escapeHtml(entry.content)}</div>
  <div class="links">
    <a href="/entries">← Back to list</a>
    <a href="/entries/${escapeHtml(entry.id)}/edits">View edit history</a>
  </div>
</body>
</html>`;
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      }
    );
  });
});

// PUT /entries/{entryId} - Update entry
app.put('/entries/:entryId', validateCSRFToken, (req, res) => {
  try {
    const { entryId } = req.params;
    const { content, modifiedBy, summary } = req.body;
    
    if (!content || !modifiedBy) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // First, check if entry exists
    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
      if (err) {
        return res.status(500).json({ error: 'An error occurred' });
      }
      
      if (!entry) {
        return res.status(404).json({ error: 'Entry not found' });
      }
      
      const now = new Date().toISOString();
      
      // Update entry
      db.run(
        'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
        [content, modifiedBy, now, entryId],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'An error occurred' });
          }
          
          // Create edit record
          db.run(
            'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
            [uuidv4(), entryId, content, modifiedBy, now, summary || ''],
            (err) => {
              if (err) {
                return res.status(500).json({ error: 'An error occurred' });
              }
              
              res.json({
                id: entryId,
                title: entry.title,
                content,
                lastModifiedBy: modifiedBy,
                lastModifiedAt: now
              });
            }
          );
        }
      );
    });
  } catch (err) {
    res.status(500).json({ error: 'An error occurred' });
  }
});

// GET /entries/{entryId}/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;
  
  // First check if entry exists
  db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('<html><body><h1>Error</h1><p>An error occurred</p></body></html>');
    }
    
    if (!entry) {
      return res.status(404).send('<html><body><h1>Not Found</h1><p>Entry not found</p></body></html>');
    }
    
    // Get all edits
    db.all(
      'SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt DESC',
      [entryId],
      (err, edits) => {
        if (err) {
          return res.status(500).send('<html><body><h1>Error</h1><p>An error occurred</p></body></html>');
        }
        
        let html = `<!DOCTYPE html>
<html>
<head>
  <title>Edit History - ${escapeHtml(entry.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; max-width: 1000px; }
    h1 { color: #333; }
    .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; background: #f9f9f9; }
    .edit-meta { color: #666; font-size: 0.9em; margin-bottom: 10px; }
    .diff { font-family: monospace; font-size: 0.9em; background: white; padding: 10px; border: 1px solid #ddd; }
    .links { margin-top: 20px; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Edit History - ${escapeHtml(entry.title)}</h1>
`;
        
        for (let i = 0; i < edits.length; i++) {
          const edit = edits[i];
          const prevEdit = edits[i + 1];
          
          html += `  <div class="edit">
    <div class="edit-meta">
      <strong>${escapeHtml(edit.modifiedBy)}</strong> on ${escapeHtml(new Date(edit.modifiedAt).toLocaleString())}${edit.summary ? ` - ${escapeHtml(edit.summary)}` : ''}
    </div>
    <div class="diff">
`;
          
          if (prevEdit) {
            html += generateDiff(prevEdit.content, edit.content);
          } else {
            html += `<div>${escapeHtml(edit.content)}</div>`;
          }
          
          html += `    </div>
  </div>
`;
        }
        
        html += `  <div class="links">
    <a href="/entries/${escapeHtml(entryId)}">← Back to entry</a>
  </div>
</body>
</html>`;
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      }
    );
  });
});

// CSRF token endpoint (for clients to get token)
app.get('/csrf-token', (req, res) => {
  const token = req.cookies.csrfToken;
  res.json({ csrfToken: token });
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An error occurred' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wiki server running on http://0.0.0.0:${PORT}`);
});