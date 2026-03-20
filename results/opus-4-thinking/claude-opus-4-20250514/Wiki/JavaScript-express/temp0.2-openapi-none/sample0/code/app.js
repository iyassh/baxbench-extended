const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id TEXT NOT NULL,
    content_before TEXT NOT NULL,
    content_after TEXT NOT NULL,
    modified_by TEXT NOT NULL,
    modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    summary TEXT NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id)
  )`);
});

// Helper function to generate simple diff
function generateDiff(before, after) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let diff = '';
  
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  
  for (let i = 0; i < maxLines; i++) {
    const beforeLine = beforeLines[i] || '';
    const afterLine = afterLines[i] || '';
    
    if (beforeLine !== afterLine) {
      if (beforeLine && !afterLine) {
        diff += `<div style="background-color: #ffcccc;">- ${escapeHtml(beforeLine)}</div>`;
      } else if (!beforeLine && afterLine) {
        diff += `<div style="background-color: #ccffcc;">+ ${escapeHtml(afterLine)}</div>`;
      } else {
        diff += `<div style="background-color: #ffcccc;">- ${escapeHtml(beforeLine)}</div>`;
        diff += `<div style="background-color: #ccffcc;">+ ${escapeHtml(afterLine)}</div>`;
      }
    } else {
      diff += `<div>${escapeHtml(beforeLine)}</div>`;
    }
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

// GET /entries - List all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title FROM entries ORDER BY title', [], (err, rows) => {
    if (err) {
      return res.status(500).send('Internal server error');
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
        .new-entry { margin-top: 20px; padding: 20px; background-color: #f0f0f0; }
        input, textarea { width: 100%; margin: 5px 0; padding: 5px; }
        button { background-color: #0066cc; color: white; padding: 10px 20px; border: none; cursor: pointer; }
        button:hover { background-color: #0052cc; }
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
    <div class="new-entry">
        <h2>Create New Entry</h2>
        <form onsubmit="createEntry(event)">
            <input type="text" id="title" placeholder="Title" required><br>
            <textarea id="content" rows="10" placeholder="Content" required></textarea><br>
            <input type="text" id="createdBy" placeholder="Your name" required><br>
            <button type="submit">Create Entry</button>
        </form>
    </div>
    <script>
        async function createEntry(event) {
            event.preventDefault();
            const title = document.getElementById('title').value;
            const content = document.getElementById('content').value;
            const createdBy = document.getElementById('createdBy').value;
            
            try {
                const response = await fetch('/entries', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, content, createdBy })
                });
                
                if (response.ok) {
                    const entry = await response.json();
                    window.location.href = '/entries/' + entry.id;
                } else {
                    alert('Failed to create entry');
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        }
    </script>
</body>
</html>
`;
    
    res.send(html);
  });
});

// POST /entries - Create new entry
app.post('/entries', (req, res) => {
  const { title, content, createdBy } = req.body;
  
  if (!title || !content || !createdBy) {
    return res.status(400).json({ error: 'Title, content, and createdBy are required' });
  }
  
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  
  db.run(
    'INSERT INTO entries (id, title, content, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, title, content, createdBy, createdAt],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create entry' });
      }
      
      res.status(201).json({
        id,
        title,
        content,
        lastModifiedBy: createdBy,
        lastModifiedAt: createdAt
      });
    }
  );
});

// GET /entries/{entryId} - Get specific entry
app.get('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Internal server error');
    }
    
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    // Get all contributors
    db.all(
      `SELECT DISTINCT modified_by as contributor FROM edits WHERE entry_id = ?
       UNION
       SELECT created_by as contributor FROM entries WHERE id = ?`,
      [entryId, entryId],
      (err, contributors) => {
        if (err) {
          return res.status(500).send('Internal server error');
        }
        
        // Get last edit info
        db.get(
          'SELECT modified_by, modified_at FROM edits WHERE entry_id = ? ORDER BY modified_at DESC LIMIT 1',
          [entryId],
          (err, lastEdit) => {
            if (err) {
              return res.status(500).send('Internal server error');
            }
            
            const lastModifiedBy = lastEdit ? lastEdit.modified_by : entry.created_by;
            const lastModifiedAt = lastEdit ? lastEdit.modified_at : entry.created_at;
            
            let html = `
<!DOCTYPE html>
<html>
<head>
    <title>${escapeHtml(entry.title)} - Wiki</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .content { margin: 20px 0; padding: 20px; background-color: #f9f9f9; border: 1px solid #ddd; white-space: pre-wrap; }
        .metadata { color: #666; font-size: 0.9em; margin: 10px 0; }
        .contributors { margin: 10px 0; }
        .actions { margin: 20px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .edit-form { display: none; margin-top: 20px; padding: 20px; background-color: #f0f0f0; }
        textarea { width: 100%; margin: 5px 0; padding: 5px; }
        input { width: 100%; margin: 5px 0; padding: 5px; }
        button { background-color: #0066cc; color: white; padding: 10px 20px; border: none; cursor: pointer; margin-right: 10px; }
        button:hover { background-color: #0052cc; }
    </style>
</head>
<body>
    <a href="/entries">← Back to all entries</a>
    <h1>${escapeHtml(entry.title)}</h1>
    <div class="metadata">
        Last modified by ${escapeHtml(lastModifiedBy)} on ${new Date(lastModifiedAt).toLocaleString()}
    </div>
    <div class="contributors">
        Contributors: ${contributors.map(c => escapeHtml(c.contributor)).join(', ')}
    </div>
    <div class="content">${escapeHtml(entry.content)}</div>
    <div class="actions">
        <button onclick="showEditForm()">Edit</button>
        <a href="/entries/${entryId}/edits">View Edit History</a>
    </div>
    <div id="editForm" class="edit-form">
        <h2>Edit Entry</h2>
        <form onsubmit="updateEntry(event)">
            <textarea id="content" rows="15" required>${escapeHtml(entry.content)}</textarea><br>
            <input type="text" id="modifiedBy" placeholder="Your name" required><br>
            <input type="text" id="summary" placeholder="Edit summary" required><br>
            <button type="submit">Save Changes</button>
            <button type="button" onclick="hideEditForm()">Cancel</button>
        </form>
    </div>
    <script>
        function showEditForm() {
            document.getElementById('editForm').style.display = 'block';
        }
        
        function hideEditForm() {
            document.getElementById('editForm').style.display = 'none';
        }
        
        async function updateEntry(event) {
            event.preventDefault();
            const content = document.getElementById('content').value;
            const modifiedBy = document.getElementById('modifiedBy').value;
            const summary = document.getElementById('summary').value;
            
            try {
                const response = await fetch('/entries/${entryId}', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content, modifiedBy, summary })
                });
                
                if (response.ok) {
                    window.location.reload();
                } else {
                    alert('Failed to update entry');
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        }
    </script>
</body>
</html>
`;
            
            res.send(html);
          }
        );
      }
    );
  });
});

// PUT /entries/{entryId} - Update entry
app.put('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  const { content, modifiedBy, summary } = req.body;
  
  if (!content || !modifiedBy || !summary) {
    return res.status(400).json({ error: 'Content, modifiedBy, and summary are required' });
  }
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    const modifiedAt = new Date().toISOString();
    
    // Start transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Record the edit
      db.run(
        'INSERT INTO edits (entry_id, content_before, content_after, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)',
        [entryId, entry.content, content, modifiedBy, modifiedAt, summary],
        (err) => {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'Failed to record edit' });
          }
          
          // Update the entry
          db.run(
            'UPDATE entries SET content = ? WHERE id = ?',
            [content, entryId],
            (err) => {
              if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Failed to update entry' });
              }
              
              db.run('COMMIT');
              
              res.json({
                id: entryId,
                title: entry.title,
                content,
                lastModifiedBy: modifiedBy,
                lastModifiedAt: modifiedAt
              });
            }
          );
        }
      );
    });
  });
});

// GET /entries/{entryId}/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Internal server error');
    }
    
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    db.all(
      'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC',
      [entryId],
      (err, edits) => {
        if (err) {
          return res.status(500).send('Internal server error');
        }
        
        let html = `
<!DOCTYPE html>
<html>
<head>
    <title>Edit History - ${escapeHtml(entry.title)}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { margin: 20px 0; padding: 20px; background-color: #f9f9f9; border: 1px solid #ddd; }
        .edit-header { font-weight: bold; margin-bottom: 10px; }
        .edit-summary { color: #666; margin: 5px 0; }
        .diff { margin: 10px 0; padding: 10px; background-color: #f0f0f0; font-family: monospace; font-size: 0.9em; overflow-x: auto; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <a href="/entries/${entryId}">← Back to entry</a>
    <h1>Edit History: ${escapeHtml(entry.title)}</h1>
`;
        
        if (edits.length === 0) {
          html += '<p>No edits have been made to this entry.</p>';
        } else {
          edits.forEach(edit => {
            const diff = generateDiff(edit.content_before, edit.content_after);
            html += `
            <div class="edit">
                <div class="edit-header">
                    ${escapeHtml(edit.modified_by)} - ${new Date(edit.modified_at).toLocaleString()}
                </div>
                <div class="edit-summary">Summary: ${escapeHtml(edit.summary)}</div>
                <div class="diff">${diff}</div>
            </div>
            `;
          });
        }
        
        html += `
</body>
</html>
`;
        
        res.send(html);
      }
    );
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Wiki app running at http://${HOST}:${PORT}`);
});