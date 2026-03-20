const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('Database connected');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Create entries table
    db.run(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        lastModifiedBy TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastModifiedAt TEXT NOT NULL
      )
    `);

    // Create edits table for tracking changes
    db.run(`
      CREATE TABLE IF NOT EXISTS edits (
        id TEXT PRIMARY KEY,
        entryId TEXT NOT NULL,
        content TEXT NOT NULL,
        previousContent TEXT,
        modifiedBy TEXT NOT NULL,
        modifiedAt TEXT NOT NULL,
        summary TEXT,
        FOREIGN KEY (entryId) REFERENCES entries(id)
      )
    `);
  });
}

// Helper function to generate diff
function generateDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  
  let diff = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    
    if (oldLine !== newLine) {
      if (oldLine && !newLine) {
        diff.push(`<span style="color: red;">- ${escapeHtml(oldLine)}</span>`);
      } else if (!oldLine && newLine) {
        diff.push(`<span style="color: green;">+ ${escapeHtml(newLine)}</span>`);
      } else {
        diff.push(`<span style="color: red;">- ${escapeHtml(oldLine)}</span>`);
        diff.push(`<span style="color: green;">+ ${escapeHtml(newLine)}</span>`);
      }
    } else if (oldLine) {
      diff.push(`  ${escapeHtml(oldLine)}`);
    }
  }
  
  return diff.join('\n');
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

// GET /entries - List all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title FROM entries ORDER BY title', [], (err, rows) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Wiki Entries</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
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
      html += `<li><a href="/entries/${row.id}">${escapeHtml(row.title)}</a></li>`;
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
    `INSERT INTO entries (id, title, content, createdBy, lastModifiedBy, createdAt, lastModifiedAt) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, title, content, createdBy, createdBy, now, now],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Create initial edit record
      const editId = uuidv4();
      db.run(
        `INSERT INTO edits (id, entryId, content, previousContent, modifiedBy, modifiedAt, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [editId, id, content, '', createdBy, now, 'Initial creation'],
        (err) => {
          if (err) {
            console.error('Error creating edit record:', err);
          }
        }
      );
      
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
  const { entryId } = req.params;
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    // Get all contributors
    db.all(
      'SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ? ORDER BY modifiedBy',
      [entryId],
      (err, contributors) => {
        if (err) {
          contributors = [];
        }
        
        const contributorList = contributors.map(c => c.modifiedBy).join(', ');
        
        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>${escapeHtml(entry.title)}</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
              h1 { color: #333; }
              .meta { color: #666; font-size: 0.9em; margin: 20px 0; }
              .content { line-height: 1.6; white-space: pre-wrap; }
              .nav { margin: 20px 0; }
              a { color: #0066cc; text-decoration: none; margin-right: 15px; }
              a:hover { text-decoration: underline; }
            </style>
          </head>
          <body>
            <div class="nav">
              <a href="/entries">← Back to all entries</a>
              <a href="/entries/${entry.id}/edits">View edit history</a>
            </div>
            <h1>${escapeHtml(entry.title)}</h1>
            <div class="meta">
              <strong>Last modified:</strong> ${entry.lastModifiedAt} by ${escapeHtml(entry.lastModifiedBy)}<br>
              <strong>Contributors:</strong> ${escapeHtml(contributorList)}
            </div>
            <div class="content">${escapeHtml(entry.content)}</div>
          </body>
          </html>
        `;
        
        res.type('text/html').send(html);
      }
    );
  });
});

// PUT /entries/{entryId} - Update entry
app.put('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  const { content, modifiedBy, summary } = req.body;
  
  if (!content || !modifiedBy || !summary) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Get current entry
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    const now = new Date().toISOString();
    const previousContent = entry.content;
    
    // Update entry
    db.run(
      'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
      [content, modifiedBy, now, entryId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        
        // Create edit record
        const editId = uuidv4();
        db.run(
          `INSERT INTO edits (id, entryId, content, previousContent, modifiedBy, modifiedAt, summary)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [editId, entryId, content, previousContent, modifiedBy, now, summary],
          (err) => {
            if (err) {
              console.error('Error creating edit record:', err);
            }
          }
        );
        
        res.json({
          id: entryId,
          title: entry.title,
          content,
          lastModifiedBy: modifiedBy,
          lastModifiedAt: now
        });
      }
    );
  });
});

// GET /entries/{entryId}/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;
  
  // Check if entry exists
  db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    // Get all edits
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
              body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
              h1 { color: #333; }
              .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; border-radius: 5px; }
              .edit-header { font-weight: bold; margin-bottom: 10px; color: #555; }
              .diff { 
                background: #f5f5f5; 
                padding: 10px; 
                border-radius: 3px; 
                font-family: monospace; 
                white-space: pre-wrap;
                font-size: 0.9em;
              }
              .nav { margin: 20px 0; }
              a { color: #0066cc; text-decoration: none; }
              a:hover { text-decoration: underline; }
            </style>
          </head>
          <body>
            <div class="nav">
              <a href="/entries/${entryId}">← Back to entry</a>
            </div>
            <h1>Edit History - ${escapeHtml(entry.title)}</h1>
        `;
        
        edits.forEach(edit => {
          const diff = generateDiff(edit.previousContent || '', edit.content);
          html += `
            <div class="edit">
              <div class="edit-header">
                ${edit.modifiedAt} by ${escapeHtml(edit.modifiedBy)}
                ${edit.summary ? `- ${escapeHtml(edit.summary)}` : ''}
              </div>
              <div class="diff">${diff}</div>
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
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wiki server running on http://0.0.0.0:${PORT}`);
});