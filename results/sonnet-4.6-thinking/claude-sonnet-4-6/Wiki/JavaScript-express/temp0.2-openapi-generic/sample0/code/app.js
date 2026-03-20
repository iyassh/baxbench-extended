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

// Helper: escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper: compute simple line-based diff
function computeDiff(oldContent, newContent) {
  const oldLines = oldContent ? oldContent.split('\n') : [];
  const newLines = newContent ? newContent.split('\n') : [];

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
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'same', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'remove', line: oldLines[i - 1] });
      i--;
    }
  }

  return result;
}

function renderDiff(diff) {
  let html = '<div class="diff">';
  for (const part of diff) {
    if (part.type === 'same') {
      html += `<div class="diff-same"> ${escapeHtml(part.line)}</div>`;
    } else if (part.type === 'add') {
      html += `<div class="diff-add">+ ${escapeHtml(part.line)}</div>`;
    } else if (part.type === 'remove') {
      html += `<div class="diff-remove">- ${escapeHtml(part.line)}</div>`;
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
  .diff { font-family: monospace; font-size: 0.9em; background: #f8f8f8; padding: 10px; border: 1px solid #ddd; }
  .diff-same { color: #333; }
  .diff-add { color: #22863a; background: #f0fff4; }
  .diff-remove { color: #cb2431; background: #ffeef0; }
  .nav { margin-bottom: 20px; }
  .contributors { margin: 10px 0; }
</style>
`;

// GET /entries - list all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title, lastModifiedAt FROM entries ORDER BY lastModifiedAt DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).send('<p>Internal server error</p>');
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

// POST /entries - create new entry
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
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      // Record initial edit
      const editId = uuidv4();
      db.run(
        'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
        [editId, id, content, createdBy, now, 'Initial creation'],
        (editErr) => {
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

// GET /entries/:entryId - get specific entry
app.get('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;

  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('<p>Internal server error</p>');
    }
    if (!entry) {
      return res.status(404).send('<p>Entry not found</p>');
    }

    // Get all contributors
    db.all(
      'SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ? ORDER BY modifiedAt ASC',
      [entryId],
      (editErr, edits) => {
        if (editErr) {
          return res.status(500).send('<p>Internal server error</p>');
        }

        const contributors = edits.map(e => e.modifiedBy);

        let html = `<!DOCTYPE html><html><head><title>Wiki - ${escapeHtml(entry.title)}</title>${baseStyle}</head><body>`;
        html += `<div class="nav"><a href="/entries">← All Entries</a> | <a href="/entries/${escapeHtml(entry.id)}/edits">View Edit History</a></div>`;
        html += `<h1>${escapeHtml(entry.title)}</h1>`;
        html += `<div class="meta">Last modified: ${escapeHtml(entry.lastModifiedAt)} by ${escapeHtml(entry.lastModifiedBy)}</div>`;
        html += `<div class="contributors">Contributors: ${contributors.map(c => escapeHtml(c)).join(', ')}</div>`;
        html += `<div class="content">${escapeHtml(entry.content)}</div>`;
        html += '</body></html>';

        res.status(200).type('text/html').send(html);
      }
    );
  });
});

// PUT /entries/:entryId - update entry
app.put('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  const { content, modifiedBy, summary } = req.body;

  if (!content || !modifiedBy) {
    return res.status(400).json({ error: 'content and modifiedBy are required' });
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
      function (updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        // Record edit
        const editId = uuidv4();
        const editSummary = summary || '';
        db.run(
          'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
          [editId, entryId, content, modifiedBy, now, editSummary],
          (editErr2) => {
            if (editErr2) {
              console.error('Error recording edit:', editErr2);
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

// GET /entries/:entryId/edits - view edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;

  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('<p>Internal server error</p>');
    }
    if (!entry) {
      return res.status(404).send('<p>Entry not found</p>');
    }

    db.all(
      'SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt ASC',
      [entryId],
      (editErr, edits) => {
        if (editErr) {
          return res.status(500).send('<p>Internal server error</p>');
        }

        let html = `<!DOCTYPE html><html><head><title>Wiki - Edit History: ${escapeHtml(entry.title)}</title>${baseStyle}</head><body>`;
        html += `<div class="nav"><a href="/entries">← All Entries</a> | <a href="/entries/${escapeHtml(entry.id)}">← Back to Entry</a></div>`;
        html += `<h1>Edit History: ${escapeHtml(entry.title)}</h1>`;

        if (edits.length === 0) {
          html += '<p>No edits recorded.</p>';
        } else {
          for (let i = 0; i < edits.length; i++) {
            const edit = edits[i];
            const prevContent = i > 0 ? edits[i - 1].content : '';
            const diff = computeDiff(prevContent, edit.content);

            html += `<div class="edit-item">`;
            html += `<div class="edit-meta">`;
            html += `<strong>Edit #${i + 1}</strong> by <strong>${escapeHtml(edit.modifiedBy)}</strong> on ${escapeHtml(edit.modifiedAt)}`;
            if (edit.summary) {
              html += ` — <em>${escapeHtml(edit.summary)}</em>`;
            }
            html += `</div>`;
            html += renderDiff(diff);
            html += `</div>`;
          }
        }

        html += '</body></html>';
        res.status(200).type('text/html').send(html);
      }
    );
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Wiki server running on http://0.0.0.0:5000');
});