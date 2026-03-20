const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
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

// Helper function to compute a simple diff
function computeDiff(oldContent, newContent) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  let diffHtml = '<div class="diff">';
  
  // Simple line-by-line diff
  const maxLen = Math.max(oldLines.length, newLines.length);
  
  // Build sets for quick lookup
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  
  // Find removed lines
  const removed = oldLines.filter(l => !newSet.has(l));
  // Find added lines
  const added = newLines.filter(l => !oldSet.has(l));
  
  if (removed.length === 0 && added.length === 0) {
    diffHtml += '<p>No changes</p>';
  } else {
    removed.forEach(line => {
      diffHtml += `<div class="diff-removed">- ${escapeHtml(line)}</div>`;
    });
    added.forEach(line => {
      diffHtml += `<div class="diff-added">+ ${escapeHtml(line)}</div>`;
    });
  }
  
  diffHtml += '</div>';
  return diffHtml;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    a { color: #0645ad; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .entry-list { list-style: none; padding: 0; }
    .entry-list li { padding: 8px 0; border-bottom: 1px solid #eee; }
    .meta { color: #666; font-size: 0.9em; }
    .content { margin: 20px 0; line-height: 1.6; white-space: pre-wrap; }
    .edit-item { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 4px; }
    .diff { font-family: monospace; background: #f8f8f8; padding: 10px; border-radius: 4px; }
    .diff-removed { color: #c00; background: #fdd; padding: 2px 4px; }
    .diff-added { color: #060; background: #dfd; padding: 2px 4px; }
    nav { margin-bottom: 20px; padding: 10px; background: #f0f0f0; border-radius: 4px; }
  </style>
</head>
<body>
  <nav><a href="/entries">Wiki Home</a></nav>
  ${body}
</body>
</html>`;
}

// GET /entries - List all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title, lastModifiedAt, lastModifiedBy FROM entries ORDER BY title', [], (err, rows) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    let listItems = '';
    if (rows.length === 0) {
      listItems = '<p>No entries yet. Create the first one!</p>';
    } else {
      listItems = '<ul class="entry-list">';
      rows.forEach(row => {
        listItems += `<li>
          <a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a>
          <span class="meta"> - Last modified by ${escapeHtml(row.lastModifiedBy)} on ${new Date(row.lastModifiedAt).toLocaleString()}</span>
        </li>`;
      });
      listItems += '</ul>';
    }
    
    const body = `<h1>Wiki Entries</h1>${listItems}`;
    res.send(htmlPage('Wiki - All Entries', body));
  });
});

// POST /entries - Create a new entry
app.post('/entries', (req, res) => {
  const { title, content, createdBy } = req.body;
  
  if (!title || !content || !createdBy) {
    return res.status(400).json({ error: 'title, content, and createdBy are required' });
  }
  
  const id = uuidv4();
  const now = new Date().toISOString();
  
  db.run(
    'INSERT INTO entries (id, title, content, lastModifiedBy, lastModifiedAt) VALUES (?, ?, ?, ?, ?)',
    [id, title, content, createdBy, now],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Also record the initial edit
      const editId = uuidv4();
      db.run(
        'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
        [editId, id, content, createdBy, now, 'Initial creation'],
        function(editErr) {
          if (editErr) {
            console.error('Error recording initial edit:', editErr);
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

// GET /entries/:entryId - Get a specific entry
app.get('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    if (!entry) {
      return res.status(404).send(htmlPage('Not Found', '<h1>Entry Not Found</h1><p>The requested entry does not exist.</p>'));
    }
    
    // Get contributors
    db.all('SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ?', [entryId], (err2, contributors) => {
      if (err2) {
        return res.status(500).send('Database error');
      }
      
      const contributorList = contributors.map(c => escapeHtml(c.modifiedBy)).join(', ');
      
      const body = `
        <h1>${escapeHtml(entry.title)}</h1>
        <div class="meta">
          <p>Last modified by: <strong>${escapeHtml(entry.lastModifiedBy)}</strong> on ${new Date(entry.lastModifiedAt).toLocaleString()}</p>
          <p>Contributors: ${contributorList || 'None'}</p>
          <p><a href="/entries/${escapeHtml(entry.id)}/edits">View edit history</a></p>
        </div>
        <div class="content">${escapeHtml(entry.content)}</div>
      `;
      
      res.send(htmlPage(entry.title, body));
    });
  });
});

// PUT /entries/:entryId - Update an existing entry
app.put('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  const { content, modifiedBy, summary } = req.body;
  
  if (!content || !modifiedBy) {
    return res.status(400).json({ error: 'content and modifiedBy are required' });
  }
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    const now = new Date().toISOString();
    
    db.run(
      'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
      [content, modifiedBy, now, entryId],
      function(updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Database error' });
        }
        
        // Record the edit
        const editId = uuidv4();
        db.run(
          'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
          [editId, entryId, content, modifiedBy, now, summary || ''],
          function(editErr) {
            if (editErr) {
              console.error('Error recording edit:', editErr);
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

// GET /entries/:entryId/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    if (!entry) {
      return res.status(404).send(htmlPage('Not Found', '<h1>Entry Not Found</h1><p>The requested entry does not exist.</p>'));
    }
    
    db.all('SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt ASC', [entryId], (err2, edits) => {
      if (err2) {
        return res.status(500).send('Database error');
      }
      
      let editsHtml = '';
      
      if (edits.length === 0) {
        editsHtml = '<p>No edit history available.</p>';
      } else {
        edits.forEach((edit, index) => {
          const prevContent = index > 0 ? edits[index - 1].content : '';
          const diffHtml = index > 0 ? computeDiff(prevContent, edit.content) : '<div class="diff"><p>Initial version</p></div>';
          
          editsHtml += `
            <div class="edit-item">
              <div class="meta">
                <strong>Edit #${index + 1}</strong> by <strong>${escapeHtml(edit.modifiedBy)}</strong>
                on ${new Date(edit.modifiedAt).toLocaleString()}
                ${edit.summary ? `<br>Summary: ${escapeHtml(edit.summary)}` : ''}
              </div>
              <h4>Changes:</h4>
              ${diffHtml}
            </div>
          `;
        });
      }
      
      const body = `
        <h1>Edit History: ${escapeHtml(entry.title)}</h1>
        <p><a href="/entries/${escapeHtml(entry.id)}">Back to entry</a></p>
        ${editsHtml}
      `;
      
      res.send(htmlPage(`Edit History - ${entry.title}`, body));
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Wiki server running on http://0.0.0.0:5000');
});