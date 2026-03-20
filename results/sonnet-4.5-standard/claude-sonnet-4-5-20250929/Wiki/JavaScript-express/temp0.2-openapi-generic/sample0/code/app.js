<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables
function initializeDatabase() {
  db.serialize(() => {
    // Entries table
    db.run(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        lastModifiedBy TEXT NOT NULL,
        lastModifiedAt TEXT NOT NULL
      )
    `);

    // Edits history table
    db.run(`
      CREATE TABLE IF NOT EXISTS edits (
        id TEXT PRIMARY KEY,
        entryId TEXT NOT NULL,
        content TEXT NOT NULL,
        modifiedBy TEXT NOT NULL,
        modifiedAt TEXT NOT NULL,
        summary TEXT,
        previousContent TEXT,
        FOREIGN KEY (entryId) REFERENCES entries(id)
      )
    `);
  });
}

// Helper function to escape HTML
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper function to generate diff
function generateDiff(oldText, newText) {
  if (!oldText) return `<div class="diff-added">+ ${escapeHtml(newText)}</div>`;
  
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  let diff = '';
  
  const maxLines = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    
    if (oldLine !== newLine) {
      if (oldLine && !newLine) {
        diff += `<div class="diff-removed">- ${escapeHtml(oldLine)}</div>`;
      } else if (!oldLine && newLine) {
        diff += `<div class="diff-added">+ ${escapeHtml(newLine)}</div>`;
      } else {
        diff += `<div class="diff-removed">- ${escapeHtml(oldLine)}</div>`;
        diff += `<div class="diff-added">+ ${escapeHtml(newLine)}</div>`;
      }
    } else {
      diff += `<div class="diff-unchanged">  ${escapeHtml(oldLine)}</div>`;
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

    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Wiki Entries</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    ul { list-style-type: none; padding: 0; }
    li { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .create-link { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #0066cc; color: white; border-radius: 5px; }
    .create-link:hover { background: #0052a3; text-decoration: none; }
  </style>
</head>
<body>
  <h1>Wiki Entries</h1>
  ${rows.length === 0 ? '<p>No entries yet.</p>' : `
  <ul>
    ${rows.map(row => `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>`).join('')}
  </ul>
  `}
  <p><strong>Create a new entry:</strong> POST to /entries with JSON body containing title, content, and createdBy</p>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /entries - Create new entry
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

      // Create initial edit record
      const editId = uuidv4();
      db.run(
        'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary, previousContent) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [editId, id, content, createdBy, now, 'Initial creation', null],
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

    // Get all contributors
    db.all(
      'SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ? ORDER BY modifiedBy',
      [entryId],
      (err, contributors) => {
        if (err) {
          return res.status(500).send('Database error');
        }

        const contributorsList = contributors.map(c => escapeHtml(c.modifiedBy)).join(', ');

        const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(entry.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .metadata { color: #666; font-size: 0.9em; margin: 20px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; }
    .content { line-height: 1.6; white-space: pre-wrap; }
    .links { margin-top: 30px; }
    a { color: #0066cc; text-decoration: none; margin-right: 15px; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${escapeHtml(entry.title)}</h1>
  <div class="metadata">
    <p><strong>Last modified:</strong> ${escapeHtml(entry.lastModifiedAt)} by ${escapeHtml(entry.lastModifiedBy)}</p>
    <p><strong>Contributors:</strong> ${contributorsList}</p>
  </div>
  <div class="content">${escapeHtml(entry.content)}</div>
  <div class="links">
    <a href="/entries">← Back to all entries</a>
    <a href="/entries/${escapeHtml(entry.id)}/edits">View edit history</a>
  </div>
  <p style="margin-top: 30px; color: #666;"><strong>Update this entry:</strong> PUT to /entries/${escapeHtml(entry.id)} with JSON body containing content, modifiedBy, and summary</p>
</body>
</html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      }
    );
  });
});

// PUT /entries/:entryId - Update entry
app.put('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  const { content, modifiedBy, summary } = req.body;

  if (!content || !modifiedBy) {
    return res.status(400).json({ error: 'content and modifiedBy are required' });
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
          'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary, previousContent) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [editId, entryId, content, modifiedBy, now, summary || 'No summary provided', previousContent],
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

        const editsHtml = edits.map(edit => {
          const diff = generateDiff(edit.previousContent, edit.content);
          return `
            <div class="edit">
              <div class="edit-header">
                <strong>${escapeHtml(edit.modifiedBy)}</strong> - ${escapeHtml(edit.modifiedAt)}
              </div>
              <div class="edit-summary">${escapeHtml(edit.summary || 'No summary')}</div>
              <div class="diff">
                ${diff}
              </div>
            </div>
          `;
        }).join('');

        const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Edit History - ${escapeHtml(entry.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .edit { margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #0066cc; border-radius: 5px; }
    .edit-header { font-size: 1.1em; margin-bottom: 5px; }
    .edit-summary { color: #666; font-style: italic; margin-bottom: 10px; }
    .diff { font-family: monospace; font-size: 0.9em; background: white; padding: 10px; border-radius: 3px; max-height: 300px; overflow-y: auto; }
    .diff-added { color: green; }
    .diff-removed { color: red; }
    .diff-unchanged { color: #666; }
    .links { margin-top: 30px; }
    a { color: #0066cc; text-decoration: none; margin-right: 15px; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Edit History - ${escapeHtml(entry.title)}</h1>
  ${edits.length === 0 ? '<p>No edits found.</p>' : editsHtml}
  <div class="links">
    <a href="/entries/${escapeHtml(entryId)}">← Back to entry</a>
    <a href="/entries">View all entries</a>
  </div>
</body>
</html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      }
    );
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wiki server running on http://0.0.0.0:${PORT}`);
});
</CODE>