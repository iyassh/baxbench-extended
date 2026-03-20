const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  // Main entries table
  db.run(`CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    lastModifiedBy TEXT NOT NULL,
    lastModifiedAt DATETIME NOT NULL,
    createdBy TEXT NOT NULL,
    createdAt DATETIME NOT NULL
  )`);
  
  // Edit history table
  db.run(`CREATE TABLE IF NOT EXISTS edits (
    id TEXT PRIMARY KEY,
    entryId TEXT NOT NULL,
    content TEXT NOT NULL,
    previousContent TEXT,
    modifiedBy TEXT NOT NULL,
    modifiedAt DATETIME NOT NULL,
    summary TEXT,
    FOREIGN KEY (entryId) REFERENCES entries(id)
  )`);
});

// Helper function to escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Helper function to generate diff
function generateDiff(oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  let diff = [];
  
  const maxLength = Math.max(oldLines.length, newLines.length);
  
  for (let i = 0; i < maxLength; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    
    if (oldLine !== newLine) {
      if (oldLine && i < oldLines.length) {
        diff.push(`<span style="background-color: #ffcccc;">- ${escapeHtml(oldLine)}</span>`);
      }
      if (newLine && i < newLines.length) {
        diff.push(`<span style="background-color: #ccffcc;">+ ${escapeHtml(newLine)}</span>`);
      }
    } else if (oldLine) {
      diff.push(`  ${escapeHtml(oldLine)}`);
    }
  }
  
  return diff.join('<br>');
}

// GET /entries - List all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title FROM entries ORDER BY title ASC', (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Database error');
    }
    
    let html = `<!DOCTYPE html>
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
        .new-entry { margin: 20px 0; padding: 20px; background: #f5f5f5; border-radius: 5px; }
        input, textarea { width: 100%; margin: 5px 0; padding: 5px; }
        button { padding: 10px 20px; background: #0066cc; color: white; border: none; cursor: pointer; }
        button:hover { background: #0052a3; }
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>`;
    
    rows.forEach(row => {
      html += `<li><a href="/entries/${encodeURIComponent(row.id)}">${escapeHtml(row.title)}</a></li>`;
    });
    
    html += `
    </ul>
    <div class="new-entry">
        <h2>Create New Entry</h2>
        <form id="newEntryForm">
            <input type="text" id="title" placeholder="Title" required><br>
            <textarea id="content" rows="10" placeholder="Content" required></textarea><br>
            <input type="text" id="createdBy" placeholder="Your Name" required><br>
            <button type="submit">Create Entry</button>
        </form>
    </div>
    <script>
        document.getElementById('newEntryForm').onsubmit = async (e) => {
            e.preventDefault();
            const response = await fetch('/entries', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    title: document.getElementById('title').value,
                    content: document.getElementById('content').value,
                    createdBy: document.getElementById('createdBy').value
                })
            });
            if (response.ok) {
                const data = await response.json();
                window.location.href = '/entries/' + data.id;
            } else {
                alert('Error creating entry');
            }
        };
    </script>
</body>
</html>`;
    
    res.type('text/html').send(html);
  });
});

// POST /entries - Create new entry
app.post('/entries', (req, res) => {
  const { title, content, createdBy } = req.body;
  
  if (!title || !content || !createdBy) {
    return res.status(400).json({ error: 'Missing required fields: title, content, createdBy' });
  }
  
  // Validate input types
  if (typeof title !== 'string' || typeof content !== 'string' || typeof createdBy !== 'string') {
    return res.status(400).json({ error: 'Invalid input types' });
  }
  
  const id = uuidv4();
  const now = new Date().toISOString();
  
  db.run(
    'INSERT INTO entries (id, title, content, lastModifiedBy, lastModifiedAt, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, title, content, createdBy, now, createdBy, now],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Also create first edit entry
      const editId = uuidv4();
      db.run(
        'INSERT INTO edits (id, entryId, content, previousContent, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [editId, id, content, '', createdBy, now, 'Initial creation'],
        (editErr) => {
          if (editErr) {
            console.error('Error creating initial edit entry:', editErr);
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
      console.error('Database error:', err);
      return res.status(500).send('Database error');
    }
    
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    // Get all contributors
    db.all(
      'SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ? ORDER BY modifiedAt ASC',
      [entryId],
      (contribErr, contributors) => {
        if (contribErr) {
          console.error('Database error:', contribErr);
          return res.status(500).send('Database error');
        }
        
        let html = `<!DOCTYPE html>
<html>
<head>
    <title>${escapeHtml(entry.title)}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; }
        .meta { color: #666; font-size: 0.9em; margin: 10px 0; }
        .content { margin: 20px 0; line-height: 1.6; white-space: pre-wrap; background: #f9f9f9; padding: 15px; border-radius: 5px; }
        .contributors { margin: 20px 0; }
        .edit-form { margin: 30px 0; padding: 20px; background: #f5f5f5; border-radius: 5px; }
        textarea, input { width: 100%; margin: 5px 0; padding: 5px; }
        button { padding: 10px 20px; background: #0066cc; color: white; border: none; cursor: pointer; }
        button:hover { background: #0052a3; }
        a { color: #0066cc; text-decoration: none; margin-right: 15px; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <a href="/entries">← Back to entries</a>
    <h1>${escapeHtml(entry.title)}</h1>
    <div class="meta">Last edited by ${escapeHtml(entry.lastModifiedBy)} on ${new Date(entry.lastModifiedAt).toLocaleString()}</div>
    <div class="content">${escapeHtml(entry.content)}</div>
    <div class="contributors">
        <strong>Contributors:</strong> ${contributors.map(c => escapeHtml(c.modifiedBy)).join(', ')}
    </div>
    <a href="/entries/${encodeURIComponent(entryId)}/edits">View edit history</a>
    
    <div class="edit-form">
        <h2>Edit Entry</h2>
        <form id="editForm">
            <textarea id="content" rows="10" required>${escapeHtml(entry.content)}</textarea><br>
            <input type="text" id="modifiedBy" placeholder="Your Name" required><br>
            <input type="text" id="summary" placeholder="Edit Summary" required><br>
            <button type="submit">Save Changes</button>
        </form>
    </div>
    
    <script>
        document.getElementById('editForm').onsubmit = async (e) => {
            e.preventDefault();
            const response = await fetch('/entries/${entryId}', {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    content: document.getElementById('content').value,
                    modifiedBy: document.getElementById('modifiedBy').value,
                    summary: document.getElementById('summary').value
                })
            });
            if (response.ok) {
                location.reload();
            } else {
                alert('Error updating entry');
            }
        };
    </script>
</body>
</html>`;
        
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
    return res.status(400).json({ error: 'Missing required fields: content, modifiedBy, summary' });
  }
  
  // Validate input types
  if (typeof content !== 'string' || typeof modifiedBy !== 'string' || typeof summary !== 'string') {
    return res.status(400).json({ error: 'Invalid input types' });
  }
  
  // Get current entry
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    const now = new Date().toISOString();
    
    // Update entry
    db.run(
      'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
      [content, modifiedBy, now, entryId],
      function(updateErr) {
        if (updateErr) {
          console.error('Database error:', updateErr);
          return res.status(500).json({ error: 'Database error' });
        }
        
        // Record edit
        const editId = uuidv4();
        db.run(
          'INSERT INTO edits (id, entryId, content, previousContent, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [editId, entryId, content, entry.content, modifiedBy, now, summary],
          (editErr) => {
            if (editErr) {
              console.error('Error creating edit entry:', editErr);
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
  
  db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Database error');
    }
    
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    db.all(
      'SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt DESC',
      [entryId],
      (editsErr, edits) => {
        if (editsErr) {
          console.error('Database error:', editsErr);
          return res.status(500).send('Database error');
        }
        
        let html = `<!DOCTYPE html>
<html>
<head>
    <title>Edit History - ${escapeHtml(entry.title)}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; border-radius: 5px; }
        .edit-meta { background-color: #f5f5f5; padding: 10px; margin: -15px -15px 10px -15px; border-radius: 5px 5px 0 0; }
        .diff { background-color: #f9f9f9; padding: 10px; font-family: monospace; white-space: pre-wrap; overflow-x: auto; line-height: 1.4; }
        .summary { font-style: italic; color: #666; margin: 10px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <a href="/entries/${encodeURIComponent(entryId)}">← Back to entry</a>
    <h1>Edit History: ${escapeHtml(entry.title)}</h1>`;
        
        edits.forEach((edit, index) => {
          const diff = generateDiff(edit.previousContent || '', edit.content);
          html += `
    <div class="edit">
        <div class="edit-meta">
            <strong>${escapeHtml(edit.modifiedBy)}</strong> edited on ${new Date(edit.modifiedAt).toLocaleString()}
        </div>`;
          if (edit.summary) {
            html += `<div class="summary">Summary: ${escapeHtml(edit.summary)}</div>`;
          }
          html += `
        <div class="diff">${diff}</div>
    </div>`;
        });
        
        if (edits.length === 0) {
          html += '<p>No edits recorded yet.</p>';
        }
        
        html += `
</body>
</html>`;
        
        res.type('text/html').send(html);
      }
    );
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).send('Internal Server Error');
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Wiki server running on http://0.0.0.0:5000');
});