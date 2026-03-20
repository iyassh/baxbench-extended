const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS edits (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      content TEXT NOT NULL,
      modified_by TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      summary TEXT,
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )
  `);
});

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

// Helper function to generate diff
function generateDiff(oldContent, newContent) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  let diff = [];
  
  const maxLines = Math.max(oldLines.length, newLines.length);
  
  for (let i = 0; i < maxLines; i++) {
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
  
  return diff.join('');
}

// GET /entries - List all entries
app.get('/entries', (req, res) => {
  db.all(`SELECT id, title FROM entries ORDER BY title`, (err, rows) => {
    if (err) {
      return res.status(500).send('Internal Server Error');
    }
    
    let html = `
      <!DOCTYPE html>
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
      html += `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>`;
    });
    
    html += `
        </ul>
      </body>
      </html>
    `;
    
    res.set('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /entries - Create new entry
app.post('/entries', (req, res) => {
  const { title, content, createdBy } = req.body;
  
  if (!title || !content || !createdBy) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const entryId = uuidv4();
  const editId = uuidv4();
  const now = new Date().toISOString();
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    db.run(
      `INSERT INTO entries (id, title, created_by, created_at) VALUES (?, ?, ?, ?)`,
      [entryId, title, createdBy, now],
      function(err) {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Failed to create entry' });
        }
        
        db.run(
          `INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)`,
          [editId, entryId, content, createdBy, now, 'Initial creation'],
          function(err) {
            if (err) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to create entry' });
            }
            
            db.run('COMMIT');
            
            res.status(201).json({
              id: entryId,
              title: title,
              content: content,
              lastModifiedBy: createdBy,
              lastModifiedAt: now
            });
          }
        );
      }
    );
  });
});

// GET /entries/{entryId} - Get specific entry
app.get('/entries/:entryId', (req, res) => {
  const entryId = req.params.entryId;
  
  db.get(
    `SELECT e.id, e.title, ed.content, ed.modified_by as lastModifiedBy, ed.modified_at as lastModifiedAt
     FROM entries e
     JOIN edits ed ON e.id = ed.entry_id
     WHERE e.id = ?
     ORDER BY ed.modified_at DESC
     LIMIT 1`,
    [entryId],
    (err, entry) => {
      if (err) {
        return res.status(500).send('Internal Server Error');
      }
      
      if (!entry) {
        return res.status(404).send('Entry not found');
      }
      
      // Get all contributors
      db.all(
        `SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by`,
        [entryId],
        (err, contributors) => {
          if (err) {
            return res.status(500).send('Internal Server Error');
          }
          
          const contributorsList = contributors.map(c => escapeHtml(c.modified_by)).join(', ');
          
          const html = `
            <!DOCTYPE html>
            <html>
            <head>
              <title>${escapeHtml(entry.title)}</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                h1 { color: #333; }
                .metadata { color: #666; font-size: 14px; margin-bottom: 20px; }
                .content { line-height: 1.6; white-space: pre-wrap; }
                a { color: #0066cc; text-decoration: none; }
                a:hover { text-decoration: underline; }
              </style>
            </head>
            <body>
              <h1>${escapeHtml(entry.title)}</h1>
              <div class="metadata">
                Last modified by ${escapeHtml(entry.lastModifiedBy)} on ${new Date(entry.lastModifiedAt).toLocaleString()}<br>
                Contributors: ${contributorsList}<br>
                <a href="/entries/${escapeHtml(entryId)}/edits">View edit history</a> | 
                <a href="/entries">Back to all entries</a>
              </div>
              <div class="content">${escapeHtml(entry.content)}</div>
            </body>
            </html>
          `;
          
          res.set('Content-Type', 'text/html');
          res.send(html);
        }
      );
    }
  );
});

// PUT /entries/{entryId} - Update entry
app.put('/entries/:entryId', (req, res) => {
  const entryId = req.params.entryId;
  const { content, modifiedBy, summary } = req.body;
  
  if (!content || !modifiedBy || !summary) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Check if entry exists
  db.get(`SELECT id, title FROM entries WHERE id = ?`, [entryId], (err, entry) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    const editId = uuidv4();
    const now = new Date().toISOString();
    
    db.run(
      `INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)`,
      [editId, entryId, content, modifiedBy, now, summary],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to update entry' });
        }
        
        res.json({
          id: entryId,
          title: entry.title,
          content: content,
          lastModifiedBy: modifiedBy,
          lastModifiedAt: now
        });
      }
    );
  });
});

// GET /entries/{entryId}/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const entryId = req.params.entryId;
  
  // First check if entry exists
  db.get(`SELECT title FROM entries WHERE id = ?`, [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Internal Server Error');
    }
    
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    // Get all edits
    db.all(
      `SELECT id, content, modified_by, modified_at, summary 
       FROM edits 
       WHERE entry_id = ? 
       ORDER BY modified_at DESC`,
      [entryId],
      (err, edits) => {
        if (err) {
          return res.status(500).send('Internal Server Error');
        }
        
        let html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>Edit History - ${escapeHtml(entry.title)}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; }
              h1 { color: #333; }
              .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; }
              .edit-header { font-weight: bold; margin-bottom: 10px; }
              .diff { font-family: monospace; background-color: #f5f5f5; padding: 10px; overflow-x: auto; }
              a { color: #0066cc; text-decoration: none; }
              a:hover { text-decoration: underline; }
            </style>
          </head>
          <body>
            <h1>Edit History: ${escapeHtml(entry.title)}</h1>
            <p><a href="/entries/${escapeHtml(entryId)}">Back to entry</a> | <a href="/entries">Back to all entries</a></p>
        `;
        
        for (let i = 0; i < edits.length; i++) {
          const edit = edits[i];
          const prevContent = i < edits.length - 1 ? edits[i + 1].content : '';
          
          html += `
            <div class="edit">
              <div class="edit-header">
                ${escapeHtml(edit.modified_by)} - ${new Date(edit.modified_at).toLocaleString()}
                <br>Summary: ${escapeHtml(edit.summary || 'No summary provided')}
              </div>
          `;
          
          if (i < edits.length - 1) {
            html += `<div class="diff">${generateDiff(prevContent, edit.content)}</div>`;
          } else {
            html += `<div class="diff">Initial content:<br>${escapeHtml(edit.content)}</div>`;
          }
          
          html += '</div>';
        }
        
        html += `
          </body>
          </html>
        `;
        
        res.set('Content-Type', 'text/html');
        res.send(html);
      }
    );
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Wiki server running on http://0.0.0.0:5000');
});