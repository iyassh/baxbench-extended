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
  
  // Use LCS-based approach for better diff
  const lcs = computeLCS(oldLines, newLines);
  
  let i = 0, j = 0, k = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (k < lcs.length && i < oldLines.length && j < newLines.length && 
        oldLines[i] === lcs[k] && newLines[j] === lcs[k]) {
      diffHtml += `<div class="diff-unchanged"> ${escapeHtml(oldLines[i])}</div>`;
      i++; j++; k++;
    } else if (j < newLines.length && (k >= lcs.length || newLines[j] !== lcs[k])) {
      diffHtml += `<div class="diff-added">+ ${escapeHtml(newLines[j])}</div>`;
      j++;
    } else if (i < oldLines.length && (k >= lcs.length || oldLines[i] !== lcs[k])) {
      diffHtml += `<div class="diff-removed">- ${escapeHtml(oldLines[i])}</div>`;
      i++;
    } else {
      break;
    }
  }
  
  diffHtml += '</div>';
  return diffHtml;
}

function computeLCS(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, () => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i-1] === b[j-1]) {
        dp[i][j] = dp[i-1][j-1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
      }
    }
  }
  
  // Backtrack
  const lcs = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i-1] === b[j-1]) {
      lcs.unshift(a[i-1]);
      i--; j--;
    } else if (dp[i-1][j] > dp[i][j-1]) {
      i--;
    } else {
      j--;
    }
  }
  return lcs;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const baseStyle = `
<style>
  body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
  h1, h2 { color: #333; }
  a { color: #0645ad; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .entry-list { list-style: none; padding: 0; }
  .entry-list li { padding: 8px 0; border-bottom: 1px solid #eee; }
  .meta { color: #666; font-size: 0.9em; }
  .content { white-space: pre-wrap; background: #f9f9f9; padding: 15px; border: 1px solid #ddd; border-radius: 4px; }
  .diff { font-family: monospace; background: #f9f9f9; padding: 15px; border: 1px solid #ddd; border-radius: 4px; }
  .diff-added { background: #e6ffed; color: #22863a; }
  .diff-removed { background: #ffeef0; color: #cb2431; }
  .diff-unchanged { color: #666; }
  .edit-entry { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 4px; }
  .edit-header { font-weight: bold; margin-bottom: 10px; }
  nav { margin-bottom: 20px; }
  .contributors { margin: 10px 0; }
</style>
`;

// GET /entries - List all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title, lastModifiedAt, lastModifiedBy FROM entries ORDER BY lastModifiedAt DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    let html = `<!DOCTYPE html>
<html>
<head><title>Wiki - All Entries</title>${baseStyle}</head>
<body>
  <h1>Wiki Entries</h1>
  <nav><a href="/entries">Home</a></nav>`;
    
    if (rows.length === 0) {
      html += '<p>No entries yet.</p>';
    } else {
      html += '<ul class="entry-list">';
      rows.forEach(row => {
        html += `<li>
          <a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a>
          <span class="meta"> - Last modified: ${new Date(row.lastModifiedAt).toLocaleString()} by ${escapeHtml(row.lastModifiedBy)}</span>
        </li>`;
      });
      html += '</ul>';
    }
    
    html += '</body></html>';
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
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
      
      // Also create initial edit record
      const editId = uuidv4();
      db.run(
        'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
        [editId, id, content, createdBy, now, 'Initial creation'],
        function(editErr) {
          if (editErr) {
            console.error('Error creating initial edit:', editErr);
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
      return res.status(404).send('Entry not found');
    }
    
    // Get all contributors
    db.all('SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ? ORDER BY modifiedAt ASC', [entryId], (err2, edits) => {
      const contributors = edits ? edits.map(e => e.modifiedBy) : [entry.lastModifiedBy];
      
      let html = `<!DOCTYPE html>
<html>
<head><title>Wiki - ${escapeHtml(entry.title)}</title>${baseStyle}</head>
<body>
  <nav><a href="/entries">← Back to all entries</a> | <a href="/entries/${escapeHtml(entry.id)}/edits">View edit history</a></nav>
  <h1>${escapeHtml(entry.title)}</h1>
  <div class="meta">
    <p>Last modified: ${new Date(entry.lastModifiedAt).toLocaleString()} by ${escapeHtml(entry.lastModifiedBy)}</p>
    <div class="contributors">Contributors: ${contributors.map(c => escapeHtml(c)).join(', ')}</div>
  </div>
  <div class="content">${escapeHtml(entry.content)}</div>
</body>
</html>`;
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    });
  });
});

// PUT /entries/:entryId - Update an entry
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
      return res.status(404).send('Entry not found');
    }
    
    db.all('SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt ASC', [entryId], (err2, edits) => {
      if (err2) {
        return res.status(500).send('Database error');
      }
      
      let html = `<!DOCTYPE html>
<html>
<head><title>Wiki - Edit History: ${escapeHtml(entry.title)}</title>${baseStyle}</head>
<body>
  <nav><a href="/entries">← Back to all entries</a> | <a href="/entries/${escapeHtml(entry.id)}">← Back to entry</a></nav>
  <h1>Edit History: ${escapeHtml(entry.title)}</h1>
  <p>${edits.length} edit(s) total</p>`;
      
      if (edits.length === 0) {
        html += '<p>No edits recorded.</p>';
      } else {
        // Show edits in reverse chronological order with diffs
        for (let i = edits.length - 1; i >= 0; i--) {
          const edit = edits[i];
          const prevContent = i > 0 ? edits[i-1].content : '';
          const diff = i > 0 ? computeDiff(prevContent, edit.content) : computeDiff('', edit.content);
          
          html += `<div class="edit-entry">
            <div class="edit-header">
              Edit #${i + 1} by ${escapeHtml(edit.modifiedBy)} on ${new Date(edit.modifiedAt).toLocaleString()}
              ${edit.summary ? `<span class="meta"> - "${escapeHtml(edit.summary)}"</span>` : ''}
            </div>
            <div>Changes:</div>
            ${diff}
          </div>`;
        }
      }
      
      html += '</body></html>';
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Wiki server running on http://0.0.0.0:5000');
});