const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Database connected');
    initDatabase();
  }
});

// Create tables if they don't exist
function initDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastModifiedBy TEXT NOT NULL,
        lastModifiedAt TEXT NOT NULL
      )
    `);

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
function generateDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  let diff = [];
  
  const maxLen = Math.max(oldLines.length, newLines.length);
  
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    
    if (oldLine === newLine) {
      diff.push({ type: 'same', line: oldLine });
    } else if (i >= oldLines.length) {
      diff.push({ type: 'add', line: newLine });
    } else if (i >= newLines.length) {
      diff.push({ type: 'remove', line: oldLine });
    } else {
      diff.push({ type: 'remove', line: oldLine });
      diff.push({ type: 'add', line: newLine });
    }
  }
  
  return diff;
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
  <title>Wiki - All Entries</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
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
    
    if (rows.length === 0) {
      html += '<li>No entries found</li>';
    } else {
      rows.forEach(row => {
        html += `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>\n`;
      });
    }
    
    html += `
  </ul>
</body>
</html>
`;
    
    res.type('html').send(html);
  });
});

// POST /entries - Create new entry
app.post('/entries', (req, res) => {
  const { title, content, createdBy } = req.body;
  
  if (!title || !content || !createdBy) {
    return res.status(400).json({ error: 'Missing required fields: title, content, createdBy' });
  }
  
  const id = uuidv4();
  const now = new Date().toISOString();
  
  db.run(
    'INSERT INTO entries (id, title, content, createdBy, createdAt, lastModifiedBy, lastModifiedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, title, content, createdBy, now, createdBy, now],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      const editId = uuidv4();
      db.run(
        'INSERT INTO edits (id, entryId, content, previousContent, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
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

// GET /entries/:entryId - Get specific entry
app.get('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    db.all(
      'SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ? ORDER BY modifiedBy',
      [entryId],
      (err, contributors) => {
        if (err) {
          return res.status(500).send('Database error');
        }
        
        const contributorList = contributors.map(c => escapeHtml(c.modifiedBy)).join(', ');
        
        let html = `
<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(entry.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .meta { color: #666; font-size: 0.9em; margin: 20px 0; }
    .content { line-height: 1.6; white-space: pre-wrap; }
    .nav { margin: 20px 0; }
    .nav a { color: #0066cc; text-decoration: none; margin-right: 15px; }
    .nav a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="nav">
    <a href="/entries">← Back to all entries</a>
    <a href="/entries/${escapeHtml(entryId)}/edits">View edit history</a>
  </div>
  <h1>${escapeHtml(entry.title)}</h1>
  <div class="meta">
    <strong>Last modified:</strong> ${escapeHtml(entry.lastModifiedAt)} by ${escapeHtml(entry.lastModifiedBy)}<br>
    <strong>Contributors:</strong> ${contributorList || 'None'}
  </div>
  <div class="content">${escapeHtml(entry.content)}</div>
</body>
</html>
`;
        
        res.type('html').send(html);
      }
    );
  });
});

// PUT /entries/:entryId - Update entry
app.put('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  const { content, modifiedBy, summary } = req.body;
  
  if (!content || !modifiedBy || !summary) {
    return res.status(400).json({ error: 'Missing required fields: content, modifiedBy, summary' });
  }
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    const now = new Date().toISOString();
    const previousContent = entry.content;
    
    db.run(
      'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
      [content, modifiedBy, now, entryId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        
        const editId = uuidv4();
        db.run(
          'INSERT INTO edits (id, entryId, content, previousContent, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
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

// GET /entries/:entryId/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;
  
  db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
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
    body { font-family: Arial, sans-serif; max-width: 1000px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .nav { margin: 20px 0; }
    .nav a { color: #0066cc; text-decoration: none; }
    .nav a:hover { text-decoration: underline; }
    .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; border-radius: 5px; }
    .edit-header { font-weight: bold; color: #333; margin-bottom: 10px; }
    .edit-summary { color: #666; font-style: italic; margin-bottom: 10px; }
    .diff { font-family: monospace; font-size: 0.9em; background: #f5f5f5; padding: 10px; overflow-x: auto; }
    .diff-line { margin: 2px 0; }
    .diff-add { background: #d4edda; color: #155724; }
    .diff-remove { background: #f8d7da; color: #721c24; }
    .diff-same { color: #666; }
  </style>
</head>
<body>
  <div class="nav">
    <a href="/entries/${escapeHtml(entryId)}">← Back to entry</a>
  </div>
  <h1>Edit History: ${escapeHtml(entry.title)}</h1>
`;
        
        if (edits.length === 0) {
          html += '<p>No edit history available</p>';
        } else {
          edits.forEach(edit => {
            const diff = generateDiff(edit.previousContent || '', edit.content);
            
            html += `
  <div class="edit">
    <div class="edit-header">
      ${escapeHtml(edit.modifiedAt)} by ${escapeHtml(edit.modifiedBy)}
    </div>
    <div class="edit-summary">
      ${escapeHtml(edit.summary || 'No summary')}
    </div>
    <div class="diff">
`;
            
            diff.forEach(line => {
              if (line.type === 'add') {
                html += `      <div class="diff-line diff-add">+ ${escapeHtml(line.line)}</div>\n`;
              } else if (line.type === 'remove') {
                html += `      <div class="diff-line diff-remove">- ${escapeHtml(line.line)}</div>\n`;
              } else {
                html += `      <div class="diff-line diff-same">  ${escapeHtml(line.line)}</div>\n`;
              }
            });
            
            html += `
    </div>
  </div>
`;
          });
        }
        
        html += `
</body>
</html>
`;
        
        res.type('html').send(html);
      }
    );
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});