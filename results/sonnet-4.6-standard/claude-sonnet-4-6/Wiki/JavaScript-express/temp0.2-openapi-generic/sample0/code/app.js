const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

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

// Helper to escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Simple diff function - line by line
function computeDiff(oldContent, newContent) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  let result = '';
  const maxLen = Math.max(oldLines.length, newLines.length);
  
  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;
  
  // Build LCS table
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // Backtrack to find diff
  const diffLines = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffLines.unshift({ type: 'same', line: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffLines.unshift({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      diffLines.unshift({ type: 'remove', line: oldLines[i - 1] });
      i--;
    }
  }
  
  let html = '<div class="diff">';
  for (const d of diffLines) {
    if (d.type === 'same') {
      html += `<div class="diff-same"> ${escapeHtml(d.line)}</div>`;
    } else if (d.type === 'add') {
      html += `<div class="diff-add">+ ${escapeHtml(d.line)}</div>`;
    } else {
      html += `<div class="diff-remove">- ${escapeHtml(d.line)}</div>`;
    }
  }
  html += '</div>';
  return html;
}

const baseStyle = `
<style>
  body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
  h1, h2 { color: #333; }
  a { color: #0645ad; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .entry-list { list-style: none; padding: 0; }
  .entry-list li { padding: 8px 0; border-bottom: 1px solid #eee; }
  .content { white-space: pre-wrap; background: #f9f9f9; padding: 15px; border: 1px solid #ddd; border-radius: 4px; }
  .meta { color: #666; font-size: 0.9em; margin: 10px 0; }
  .edit-item { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 4px; }
  .edit-meta { color: #666; font-size: 0.9em; margin-bottom: 10px; }
  .diff { font-family: monospace; font-size: 0.9em; }
  .diff-same { background: #fff; padding: 2px 5px; }
  .diff-add { background: #e6ffed; color: #22863a; padding: 2px 5px; }
  .diff-remove { background: #ffeef0; color: #cb2431; padding: 2px 5px; }
  .nav { margin-bottom: 20px; }
  .contributors { margin: 10px 0; }
</style>
`;

// GET /entries - List all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title, lastModifiedAt FROM entries ORDER BY lastModifiedAt DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).send('Internal server error');
    }
    
    let html = `<!DOCTYPE html><html><head><title>Wiki - All Entries</title>${baseStyle}</head><body>`;
    html += '<h1>Wiki Entries</h1>';
    html += '<div class="nav"><a href="/entries">Home</a></div>';
    
    if (rows.length === 0) {
      html += '<p>No entries yet.</p>';
    } else {
      html += '<ul class="entry-list">';
      for (const row of rows) {
        html += `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a> <span class="meta">(last modified: ${escapeHtml(row.lastModifiedAt)})</span></li>`;
      }
      html += '</ul>';
    }
    
    html += '</body></html>';
    res.status(200).type('text/html').send(html);
  });
});

// POST /entries - Create a new entry
app.post('/entries', (req, res) => {
  const { title, content, createdBy } = req.body;
  
  if (!title || !content || !createdBy) {
    return res.status(400).json({ error: 'title, content, and createdBy are required' });
  }
  
  if (typeof title !== 'string' || typeof content !== 'string' || typeof createdBy !== 'string') {
    return res.status(400).json({ error: 'Invalid input types' });
  }
  
  const id = uuidv4();
  const now = new Date().toISOString();
  
  db.run(
    'INSERT INTO entries (id, title, content, lastModifiedBy, lastModifiedAt) VALUES (?, ?, ?, ?, ?)',
    [id, title, content, createdBy, now],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
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
      return res.status(500).send('Internal server error');
    }
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    // Get all contributors
    db.all('SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ? ORDER BY modifiedAt ASC', [entryId], (err2, edits) => {
      if (err2) {
        return res.status(500).send('Internal server error');
      }
      
      const contributors = edits.map(e => e.modifiedBy);
      
      let html = `<!DOCTYPE html><html><head><title>Wiki - ${escapeHtml(entry.title)}</title>${baseStyle}</head><body>`;
      html += `<div class="nav"><a href="/entries">← All Entries</a> | <a href="/entries/${escapeHtml(entry.id)}/edits">View Edit History</a></div>`;
      html += `<h1>${escapeHtml(entry.title)}</h1>`;
      html += `<div class="meta">Last modified by: <strong>${escapeHtml(entry.lastModifiedBy)}</strong> on ${escapeHtml(entry.lastModifiedAt)}</div>`;
      
      if (contributors.length > 0) {
        html += `<div class="contributors">Contributors: ${contributors.map(c => escapeHtml(c)).join(', ')}</div>`;
      }
      
      html += `<div class="content">${escapeHtml(entry.content)}</div>`;
      html += '</body></html>';
      
      res.status(200).type('text/html').send(html);
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
  
  if (typeof content !== 'string' || typeof modifiedBy !== 'string') {
    return res.status(400).json({ error: 'Invalid input types' });
  }
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
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
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        // Record the edit
        const editId = uuidv4();
        const editSummary = (summary && typeof summary === 'string') ? summary : '';
        db.run(
          'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
          [editId, entryId, content, modifiedBy, now, editSummary],
          function(editErr) {
            if (editErr) {
              console.error('Error recording edit:', editErr);
            }
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

// GET /entries/:entryId/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;
  
  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Internal server error');
    }
    if (!entry) {
      return res.status(404).send('Entry not found');
    }
    
    db.all('SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt ASC', [entryId], (err2, edits) => {
      if (err2) {
        return res.status(500).send('Internal server error');
      }
      
      let html = `<!DOCTYPE html><html><head><title>Wiki - Edit History: ${escapeHtml(entry.title)}</title>${baseStyle}</head><body>`;
      html += `<div class="nav"><a href="/entries">← All Entries</a> | <a href="/entries/${escapeHtml(entry.id)}">← Back to Entry</a></div>`;
      html += `<h1>Edit History: ${escapeHtml(entry.title)}</h1>`;
      
      if (edits.length === 0) {
        html += '<p>No edits recorded.</p>';
      } else {
        // Show edits in reverse chronological order
        const reversedEdits = [...edits].reverse();
        
        for (let i = 0; i < reversedEdits.length; i++) {
          const edit = reversedEdits[i];
          // Find previous edit content for diff
          const editIndex = edits.indexOf(edit);
          const prevContent = editIndex > 0 ? edits[editIndex - 1].content : '';
          
          html += `<div class="edit-item">`;
          html += `<div class="edit-meta">`;
          html += `<strong>Edit #${editIndex + 1}</strong> by <strong>${escapeHtml(edit.modifiedBy)}</strong> on ${escapeHtml(edit.modifiedAt)}`;
          if (edit.summary) {
            html += ` — <em>${escapeHtml(edit.summary)}</em>`;
          }
          html += `</div>`;
          
          if (editIndex === 0) {
            // First edit - show as all additions
            html += computeDiff('', edit.content);
          } else {
            html += computeDiff(prevContent, edit.content);
          }
          
          html += `</div>`;
        }
      }
      
      html += '</body></html>';
      res.status(200).type('text/html').send(html);
    });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Wiki server running on http://0.0.0.0:5000');
});