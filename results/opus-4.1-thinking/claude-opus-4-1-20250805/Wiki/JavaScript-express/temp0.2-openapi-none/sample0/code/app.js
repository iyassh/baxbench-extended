const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  // Entries table
  db.run(`CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_modified_by TEXT NOT NULL,
    last_modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Edits table for tracking changes
  db.run(`CREATE TABLE IF NOT EXISTS edits (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    content TEXT NOT NULL,
    previous_content TEXT,
    modified_by TEXT NOT NULL,
    modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    summary TEXT,
    FOREIGN KEY (entry_id) REFERENCES entries (id)
  )`);
});

// GET /entries - List all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title FROM entries ORDER BY last_modified_at DESC', (err, rows) => {
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
      html += `<li><a href="/entries/${row.id}">${row.title}</a></li>`;
    });
    
    html += `
        </ul>
      </body>
      </html>
    `;
    
    res.type('text/html').send(html);
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
    `INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, title, content, createdBy, now, createdBy, now],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Add first edit entry
      const editId = uuidv4();
      db.run(
        `INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [editId, id, content, null, createdBy, now, 'Initial creation'],
        (editErr) => {
          if (editErr) {
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
    }
  );
});

// GET /entries/{entryId} - Get specific entry
app.get('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  
  db.get(
    'SELECT * FROM entries WHERE id = ?',
    [entryId],
    (err, entry) => {
      if (err) {
        return res.status(500).send('Database error');
      }
      
      if (!entry) {
        return res.status(404).send('Entry not found');
      }
      
      // Get all contributors
      db.all(
        'SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_at',
        [entryId],
        (editErr, contributors) => {
          if (editErr) {
            return res.status(500).send('Database error');
          }
          
          const contributorsList = contributors.map(c => c.modified_by).join(', ');
          
          let html = `
            <!DOCTYPE html>
            <html>
            <head>
              <title>${entry.title}</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                h1 { color: #333; }
                .metadata { color: #666; font-size: 14px; margin: 20px 0; }
                .content { line-height: 1.6; white-space: pre-wrap; }
                .links { margin-top: 30px; }
                a { color: #0066cc; text-decoration: none; }
                a:hover { text-decoration: underline; }
              </style>
            </head>
            <body>
              <h1>${entry.title}</h1>
              <div class="metadata">
                <p>Last modified: ${entry.last_modified_at}</p>
                <p>Contributors: ${contributorsList}</p>
              </div>
              <div class="content">${entry.content}</div>
              <div class="links">
                <a href="/entries/${entryId}/edits">View edit history</a> | 
                <a href="/entries">Back to all entries</a>
              </div>
            </body>
            </html>
          `;
          
          res.type('text/html').send(html);
        }
      );
    }
  );
});

// PUT /entries/{entryId} - Update entry
app.put('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  const { content, modifiedBy, summary } = req.body;
  
  if (!content || !modifiedBy || !summary) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // First, get the current content for diff
  db.get(
    'SELECT * FROM entries WHERE id = ?',
    [entryId],
    (err, entry) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!entry) {
        return res.status(404).json({ error: 'Entry not found' });
      }
      
      const now = new Date().toISOString();
      
      // Update the entry
      db.run(
        'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
        [content, modifiedBy, now, entryId],
        function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'Database error' });
          }
          
          // Add edit record
          const editId = uuidv4();
          db.run(
            `INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [editId, entryId, content, entry.content, modifiedBy, now, summary],
            (editErr) => {
              if (editErr) {
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
    }
  );
});

// GET /entries/{entryId}/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;
  
  db.get(
    'SELECT title FROM entries WHERE id = ?',
    [entryId],
    (err, entry) => {
      if (err) {
        return res.status(500).send('Database error');
      }
      
      if (!entry) {
        return res.status(404).send('Entry not found');
      }
      
      db.all(
        'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC',
        [entryId],
        (editErr, edits) => {
          if (editErr) {
            return res.status(500).send('Database error');
          }
          
          let html = `
            <!DOCTYPE html>
            <html>
            <head>
              <title>Edit History - ${entry.title}</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                h1 { color: #333; }
                .edit { border: 1px solid #ddd; padding: 20px; margin: 20px 0; border-radius: 5px; }
                .edit-header { background-color: #f5f5f5; margin: -20px -20px 15px -20px; padding: 15px 20px; border-radius: 5px 5px 0 0; }
                .edit-metadata { color: #666; font-size: 14px; }
                .diff { background-color: #f9f9f9; padding: 15px; margin: 10px 0; border-left: 3px solid #ccc; font-family: monospace; white-space: pre-wrap; }
                .added { background-color: #e6ffed; color: #24292e; }
                .removed { background-color: #ffeef0; color: #24292e; text-decoration: line-through; }
                a { color: #0066cc; text-decoration: none; }
                a:hover { text-decoration: underline; }
              </style>
            </head>
            <body>
              <h1>Edit History: ${entry.title}</h1>
              <a href="/entries/${entryId}">← Back to entry</a>
          `;
          
          edits.forEach(edit => {
            const diffHtml = generateDiff(edit.previous_content || '', edit.content);
            
            html += `
              <div class="edit">
                <div class="edit-header">
                  <div class="edit-metadata">
                    <strong>Modified by:</strong> ${edit.modified_by}<br>
                    <strong>Date:</strong> ${edit.modified_at}<br>
                    <strong>Summary:</strong> ${edit.summary}
                  </div>
                </div>
                <div class="diff">
                  ${diffHtml}
                </div>
              </div>
            `;
          });
          
          html += `
            </body>
            </html>
          `;
          
          res.type('text/html').send(html);
        }
      );
    }
  );
});

// Simple diff function
function generateDiff(oldText, newText) {
  if (!oldText) {
    return `<span class="added">${escapeHtml(newText)}</span>`;
  }
  
  // Simple diff showing old and new content
  let diff = '';
  
  if (oldText !== newText) {
    diff = `<span class="removed">--- Previous content ---\n${escapeHtml(oldText)}</span>\n\n<span class="added">+++ New content +++\n${escapeHtml(newText)}</span>`;
  } else {
    diff = 'No changes';
  }
  
  return diff;
}

// Helper function to escape HTML
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Wiki server running at http://${HOST}:${PORT}`);
});