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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function computeDiff(oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  let diff = '';

  // Simple line-by-line diff
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === newLine) {
      diff += `  ${escapeHtml(oldLine)}\n`;
    } else {
      if (oldLine !== undefined) {
        diff += `<span style="color:red;background:#fdd;">- ${escapeHtml(oldLine)}</span>\n`;
      }
      if (newLine !== undefined) {
        diff += `<span style="color:green;background:#dfd;">+ ${escapeHtml(newLine)}</span>\n`;
      }
    }
  }
  return diff;
}

// GET /entries - list all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title FROM entries ORDER BY lastModifiedAt DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).send('Internal Server Error');
    }
    let html = `<!DOCTYPE html>
<html><head><title>Wiki Entries</title></head><body>
<h1>Wiki Entries</h1>
<ul>`;
    for (const row of rows) {
      html += `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>`;
    }
    html += `</ul></body></html>`;
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
  const editId = uuidv4();

  db.serialize(() => {
    db.run(
      'INSERT INTO entries (id, title, content, lastModifiedBy, lastModifiedAt) VALUES (?, ?, ?, ?, ?)',
      [id, title, content, createdBy, now],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to create entry' });
        }

        db.run(
          'INSERT INTO edits (id, entryId, content, previousContent, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [editId, id, content, null, createdBy, now, 'Initial creation']
        );

        db.run(
          'INSERT OR IGNORE INTO contributors (entryId, name) VALUES (?, ?)',
          [id, createdBy]
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
});

// GET /entries/:entryId - get a specific entry
app.get('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;

  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Internal Server Error');
    }
    if (!entry) {
      return res.status(404).send('Entry not found');
    }

    db.all('SELECT name FROM contributors WHERE entryId = ?', [entryId], (err2, contributors) => {
      if (err2) {
        return res.status(500).send('Internal Server Error');
      }

      const contributorList = contributors.map(c => escapeHtml(c.name)).join(', ');

      let html = `<!DOCTYPE html>
<html><head><title>${escapeHtml(entry.title)}</title></head><body>
<h1>${escapeHtml(entry.title)}</h1>
<div>${escapeHtml(entry.content)}</div>
<p><strong>Last edited:</strong> ${escapeHtml(entry.lastModifiedAt)}</p>
<p><strong>Contributors:</strong> ${contributorList}</p>
<p><a href="/entries/${escapeHtml(entry.id)}/edits">View edit history</a></p>
<p><a href="/entries">Back to all entries</a></p>
</body></html>`;

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
    if (err) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    const now = new Date().toISOString();
    const editId = uuidv4();
    const previousContent = entry.content;

    db.serialize(() => {
      db.run(
        'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
        [content, modifiedBy, now, entryId]
      );

      db.run(
        'INSERT INTO edits (id, entryId, content, previousContent, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [editId, entryId, content, previousContent, modifiedBy, now, summary || '']
      );

      db.run(
        'INSERT OR IGNORE INTO contributors (entryId, name) VALUES (?, ?)',
        [entryId, modifiedBy]
      );

      res.status(200).json({
        id: entryId,
        title: entry.title,
        content,
        lastModifiedBy: modifiedBy,
        lastModifiedAt: now
      });
    });
  });
});

// GET /entries/:entryId/edits - view edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;

  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('Internal Server Error');
    }
    if (!entry) {
      return res.status(404).send('Entry not found');
    }

    db.all(
      'SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt DESC',
      [entryId],
      (err2, edits) => {
        if (err2) {
          return res.status(500).send('Internal Server Error');
        }

        let html = `<!DOCTYPE html>
<html><head><title>Edit History - ${escapeHtml(entry.title)}</title>
<style>
  .edit { border: 1px solid #ccc; margin: 10px 0; padding: 10px; }
  pre { background: #f5f5f5; padding: 10px; overflow-x: auto; }
</style>
</head><body>
<h1>Edit History for "${escapeHtml(entry.title)}"</h1>
<p><a href="/entries/${escapeHtml(entryId)}">Back to entry</a></p>`;

        for (const edit of edits) {
          const diff = computeDiff(edit.previousContent, edit.content);
          html += `<div class="edit">
<p><strong>Contributor:</strong> ${escapeHtml(edit.modifiedBy)}</p>
<p><strong>Date:</strong> ${escapeHtml(edit.modifiedAt)}</p>
<p><strong>Summary:</strong> ${escapeHtml(edit.summary)}</p>
<h3>Changes:</h3>
<pre>${diff}</pre>
</div>`;
        }

        html += `</body></html>`;
        res.status(200).type('text/html').send(html);
      }
    );
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Wiki server running on http://0.0.0.0:5000');
});