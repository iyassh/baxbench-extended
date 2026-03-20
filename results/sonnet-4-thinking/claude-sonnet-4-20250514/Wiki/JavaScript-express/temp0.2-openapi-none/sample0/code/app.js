const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
db.serialize(() => {
  // Entries table
  db.run(`CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    lastModifiedBy TEXT NOT NULL,
    lastModifiedAt TEXT NOT NULL,
    createdBy TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`);

  // Edits table for tracking changes
  db.run(`CREATE TABLE IF NOT EXISTS edits (
    id TEXT PRIMARY KEY,
    entryId TEXT NOT NULL,
    content TEXT NOT NULL,
    previousContent TEXT,
    modifiedBy TEXT NOT NULL,
    modifiedAt TEXT NOT NULL,
    summary TEXT,
    FOREIGN KEY(entryId) REFERENCES entries(id)
  )`);
});

// Routes

// GET /entries - Get list of all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title FROM entries ORDER BY title', (err, rows) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Wiki Entries</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 10px 0; }
        a { text-decoration: none; color: #0066cc; }
        a:hover { text-decoration: underline; }
        .header { border-bottom: 2px solid #ccc; padding-bottom: 20px; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Wiki Entries</h1>
      </div>
      <ul>`;
    
    rows.forEach(row => {
      html += `<li><a href="/entries/${row.id}">${escapeHtml(row.title)}</a></li>`;
    });
    
    html += `
      </ul>
    </body>
    </html>`;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /entries - Create new entry
app.post('/entries', (req, res) => {
  const { title, content, createdBy } = req.body;
  
  if (!title || !content || !createdBy) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const id = uuidv4();
  const now = new Date().toISOString();
  
  db.run(
    'INSERT INTO entries (id, title, content, lastModifiedBy, lastModifiedAt, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, title, content, createdBy, now, createdBy, now],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
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
});

// GET /entries/{entryId} - Get specific entry
app.get('/entries/:entryId', (req, res) => {
  const entryId = req.params.entryId;
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    // Get contributors
    db.all(
      'SELECT DISTINCT modifiedBy as contributor FROM edits WHERE entryId = ? UNION SELECT DISTINCT createdBy as contributor FROM entries WHERE id = ?',
      [entryId, entryId],
      (err, contributors) => {
        if (err) {
          return res.status(500).send('Database error');
        }
        
        const contributorList = contributors.map(c => c.contributor).join(', ');
        
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>${escapeHtml(entry.title)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
            .header { border-bottom: 2px solid #ccc; padding-bottom: 20px; margin-bottom: 20px; }
            .content { margin-bottom: 30px; white-space: pre-wrap; }
            .meta { color: #666; font-size: 14px; margin-bottom: 20px; }
            .links a { margin-right: 20px; color: #0066cc; text-decoration: none; }
            .links a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${escapeHtml(entry.title)}</h1>
          </div>
          <div class="meta">
            Last modified by: ${escapeHtml(entry.lastModifiedBy)}<br>
            Last modified at: ${new Date(entry.lastModifiedAt).toLocaleString()}<br>
            Contributors: ${escapeHtml(contributorList || entry.createdBy)}
          </div>
          <div class="content">${escapeHtml(entry.content)}</div>
          <div class="links">
            <a href="/entries">← Back to entries</a>
            <a href="/entries/${entryId}/edits">View edit history</a>
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
app.put('/entries/:entryId', (req, res) => {
  const entryId = req.params.entryId;
  const { content, modifiedBy, summary } = req.body;
  
  if (!content || !modifiedBy || !summary) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // First get the current entry
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    const now = new Date().toISOString();
    
    // Save edit history
    const editId = uuidv4();
    db.run(
      'INSERT INTO edits (id, entryId, content, previousContent, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [editId, entryId, content, entry.content, modifiedBy, now, summary],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        
        // Update the entry
        db.run(
          'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
          [content, modifiedBy, now, entryId],
          (err) => {
            if (err) {
              return res.status(500).json({ error: 'Database error' });
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
});

// GET /entries/{entryId}/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const entryId = req.params.entryId;
  
  // First check if entry exists
  db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    // Get edit history
    db.all(
      'SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt DESC',
      [entryId],
      (err, edits) => {
        if (err) {
          return res.status(500).send('Database error');
        }
        
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Edit History - ${escapeHtml(entry.title)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
            .header { border-bottom: 2px solid #ccc; padding-bottom: 20px; margin-bottom: 20px; }
            .edit { border: 1px solid #ddd; margin-bottom: 20px; padding: 15px; border-radius: 5px; }
            .edit-meta { color: #666; font-size: 14px; margin-bottom: 10px; }
            .diff { background: #f8f8f8; padding: 10px; border-radius: 3px; font-family: monospace; }
            .added { background: #d4edda; color: #155724; }
            .removed { background: #f8d7da; color: #721c24; }
            .unchanged { color: #666; }
            .links a { color: #0066cc; text-decoration: none; }
            .links a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Edit History - ${escapeHtml(entry.title)}</h1>
          </div>`;
        
        if (edits.length === 0) {
          html += '<p>No edits yet.</p>';
        } else {
          edits.forEach(edit => {
            const diff = createSimpleDiff(edit.previousContent, edit.content);
            html += `
            <div class="edit">
              <div class="edit-meta">
                <strong>${escapeHtml(edit.modifiedBy)}</strong> at ${new Date(edit.modifiedAt).toLocaleString()}
                <br>Summary: ${escapeHtml(edit.summary)}
              </div>
              <div class="diff">${diff}</div>
            </div>`;
          });
        }
        
        html += `
          <div class="links">
            <a href="/entries/${entryId}">← Back to entry</a>
          </div>
        </body>
        </html>`;
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      }
    );
  });
});

// Simple diff function
function createSimpleDiff(oldText, newText) {
  if (!oldText && !newText) return 'No changes';
  if (!oldText) return `<div class="added">+ ${escapeHtml(newText)}</div>`;
  if (!newText) return `<div class="removed">- ${escapeHtml(oldText)}</div>`;
  
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  
  let diff = '';
  const maxLength = Math.max(oldLines.length, newLines.length);
  
  for (let i = 0; i < maxLength; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    
    if (oldLine !== newLine) {
      if (oldLine && i < oldLines.length) {
        diff += `<div class="removed">- ${escapeHtml(oldLine)}</div>`;
      }
      if (newLine && i < newLines.length) {
        diff += `<div class="added">+ ${escapeHtml(newLine)}</div>`;
      }
    } else if (oldLine) {
      diff += `<div class="unchanged">&nbsp;&nbsp;${escapeHtml(oldLine)}</div>`;
    }
  }
  
  return diff || 'No changes';
}

// Helper function to escape HTML
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wiki server running on http://0.0.0.0:${PORT}`);
});