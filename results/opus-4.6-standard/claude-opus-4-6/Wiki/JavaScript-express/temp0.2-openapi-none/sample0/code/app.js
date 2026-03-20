const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
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
    previousContent TEXT,
    modifiedBy TEXT NOT NULL,
    modifiedAt TEXT NOT NULL,
    summary TEXT,
    FOREIGN KEY (entryId) REFERENCES entries(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS contributors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entryId TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE(entryId, name),
    FOREIGN KEY (entryId) REFERENCES entries(id)
  )`);
});

// Helper to compute a simple diff
function computeDiff(oldText, newText) {
  if (!oldText) return '<div style="color:green;">+ ' + escapeHtml(newText).replace(/\n/g, '<br>+ ') + '</div>';
  
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  let result = '';
  
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;
    
    if (oldLine === newLine) {
      result += `<div style="color:gray;">&nbsp; ${escapeHtml(oldLine)}</div>`;
    } else {
      if (oldLine !== undefined) {
        result += `<div style="color:red;">- ${escapeHtml(oldLine)}</div>`;
      }
      if (newLine !== undefined) {
        result += `<div style="color:green;">+ ${escapeHtml(newLine)}</div>`;
      }
    }
  }
  
  return result;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// GET /entries - list all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title FROM entries ORDER BY lastModifiedAt DESC', [], (err, rows) => {
    if (err) return res.status(500).send('Internal Server Error');
    
    let html = `<!DOCTYPE html>
<html>
<head><title>Wiki - All Entries</title></head>
<body>
<h1>Wiki Entries</h1>
<ul>`;
    
    rows.forEach(row => {
      html += `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>`;
    });
    
    html += `</ul>
</body>
</html>`;
    
    res.status(200).type('text/html').send(html);
  });
});

// POST /entries - create a new entry
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
      if (err) return res.status(500).json({ error: 'Failed to create entry' });
      
      // Add initial edit record
      const editId = uuidv4();
      db.run(
        'INSERT INTO edits (id, entryId, content, previousContent, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [editId, id, content, null, createdBy, now, 'Initial creation'],
        (err) => {
          if (err) console.error('Failed to create edit record:', err);
        }
      );
      
      // Add contributor
      db.run(
        'INSERT OR IGNORE INTO contributors (entryId, name) VALUES (?, ?)',
        [id, createdBy],
        (err) => {
          if (err) console.error('Failed to add contributor:', err);
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

// GET /entries/:entryId - get a specific entry
app.get('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) return res.status(500).send('Internal Server Error');
    if (!entry) return res.status(404).send('Entry not found');
    
    db.all('SELECT name FROM contributors WHERE entryId = ?', [entryId], (err, contributors) => {
      if (err) return res.status(500).send('Internal Server Error');
      
      const contributorNames = contributors.map(c => escapeHtml(c.name)).join(', ');
      
      let html = `<!DOCTYPE html>
<html>
<head><title>${escapeHtml(entry.title)} - Wiki</title></head>
<body>
<h1>${escapeHtml(entry.title)}</h1>
<div>${escapeHtml(entry.content).replace(/\n/g, '<br>')}</div>
<hr>
<p><strong>Last edited:</strong> ${escapeHtml(entry.lastModifiedAt)}</p>
<p><strong>Contributors:</strong> ${contributorNames}</p>
<p><a href="/entries/${escapeHtml(entry.id)}/edits">View edit history</a></p>
<p><a href="/entries">Back to all entries</a></p>
</body>
</html>`;
      
      res.status(200).type('text/html').send(html);
    });
  });
});

// PUT /entries/:entryId - update an entry
app.put('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  const { content, modifiedBy, summary } = req.body;
  
  if (!content || !modifiedBy) {
    return res.status(400).json({ error: 'content and modifiedBy are required' });
  }
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) return res.status(500).json({ error: 'Internal Server Error' });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    
    const now = new Date().toISOString();
    const previousContent = entry.content;
    
    db.run(
      'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
      [content, modifiedBy, now, entryId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Failed to update entry' });
        
        // Add edit record
        const editId = uuidv4();
        db.run(
          'INSERT INTO edits (id, entryId, content, previousContent, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [editId, entryId, content, previousContent, modifiedBy, now, summary || ''],
          (err) => {
            if (err) console.error('Failed to create edit record:', err);
          }
        );
        
        // Add contributor
        db.run(
          'INSERT OR IGNORE INTO contributors (entryId, name) VALUES (?, ?)',
          [entryId, modifiedBy],
          (err) => {
            if (err) console.error('Failed to add contributor:', err);
          }
        );
        
        res.status(200).json({
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

// GET /entries/:entryId/edits - view edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) return res.status(500).send('Internal Server Error');
    if (!entry) return res.status(404).send('Entry not found');
    
    db.all(
      'SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt DESC',
      [entryId],
      (err, edits) => {
        if (err) return res.status(500).send('Internal Server Error');
        
        let html = `<!DOCTYPE html>
<html>
<head><title>Edit History - ${escapeHtml(entry.title)}</title></head>
<body>
<h1>Edit History for "${escapeHtml(entry.title)}"</h1>
<a href="/entries/${escapeHtml(entryId)}">Back to entry</a>
<hr>`;
        
        edits.forEach(edit => {
          const diff = computeDiff(edit.previousContent, edit.content);
          html += `
<div style="border:1px solid #ccc; padding:10px; margin:10px 0;">
  <p><strong>Date:</strong> ${escapeHtml(edit.modifiedAt)}</p>
  <p><strong>Contributor:</strong> ${escapeHtml(edit.modifiedBy)}</p>
  <p><strong>Summary:</strong> ${escapeHtml(edit.summary || 'No summary')}</p>
  <h3>Changes:</h3>
  <div style="font-family:monospace; background:#f5f5f5; padding:10px;">
    ${diff}
  </div>
</div>`;
        });
        
        html += `
</body>
</html>`;
        
        res.status(200).type('text/html').send(html);
      }
    );
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Wiki server running on http://0.0.0.0:5000');
});