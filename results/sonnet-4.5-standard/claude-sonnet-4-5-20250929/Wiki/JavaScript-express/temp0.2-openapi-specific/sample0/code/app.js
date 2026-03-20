<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline';");
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create tables
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
    previousContent TEXT,
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
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Helper function to generate diff
function generateDiff(oldText, newText) {
  if (!oldText) oldText = '';
  if (!newText) newText = '';
  
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  
  let diff = '';
  const maxLen = Math.max(oldLines.length, newLines.length);
  
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    
    if (oldLine !== newLine) {
      if (oldLine) {
        diff += `<div style="background-color: #ffcccc; padding: 2px;">- ${escapeHtml(oldLine)}</div>`;
      }
      if (newLine) {
        diff += `<div style="background-color: #ccffcc; padding: 2px;">+ ${escapeHtml(newLine)}</div>`;
      }
    } else {
      diff += `<div style="padding: 2px;">&nbsp; ${escapeHtml(newLine)}</div>`;
    }
  }
  
  return diff;
}

// GET /entries - List all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title FROM entries ORDER BY title', [], (err, rows) => {
    if (err) {
      res.status(500).send('<html><body><h1>Error</h1><p>An error occurred</p></body></html>');
      return;
    }

    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Wiki Entries</title>
</head>
<body>
  <h1>Wiki Entries</h1>
  <ul>
`;

    rows.forEach(row => {
      html += `    <li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>\n`;
    });

    html += `
  </ul>
  <h2>Create New Entry</h2>
  <form id="createForm">
    <label>Title: <input type="text" id="title" required></label><br>
    <label>Content: <textarea id="content" required></textarea></label><br>
    <label>Created By: <input type="text" id="createdBy" required></label><br>
    <button type="submit">Create</button>
  </form>
  <script>
    document.getElementById('createForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        title: document.getElementById('title').value,
        content: document.getElementById('content').value,
        createdBy: document.getElementById('createdBy').value
      };
      const response = await fetch('/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (response.ok) {
        location.reload();
      } else {
        alert('Error creating entry');
      }
    });
  </script>
</body>
</html>
`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /entries - Create new entry
app.post('/entries', (req, res) => {
  try {
    const { title, content, createdBy } = req.body;

    if (!title || !content || !createdBy) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    db.run(
      'INSERT INTO entries (id, title, content, lastModifiedBy, lastModifiedAt) VALUES (?, ?, ?, ?, ?)',
      [id, title, content, createdBy, now],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'An error occurred' });
        }

        db.run(
          'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary, previousContent) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uuidv4(), id, content, createdBy, now, 'Initial creation', ''],
          (editErr) => {
            if (editErr) {
              return res.status(500).json({ error: 'An error occurred' });
            }

            res.status(201).json({
              id,
              title,
              content,
              lastModifiedBy: createdBy,
              lastModifiedAt: now
            });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'An error occurred' });
  }
});

// GET /entries/:entryId - Get specific entry
app.get('/entries/:entryId', (req, res) => {
  const entryId = req.params.entryId;

  db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('<html><body><h1>Error</h1><p>An error occurred</p></body></html>');
    }

    if (!entry) {
      return res.status(404).send('<html><body><h1>Not Found</h1><p>Entry not found</p></body></html>');
    }

    db.all(
      'SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ? ORDER BY modifiedAt',
      [entryId],
      (editErr, contributors) => {
        if (editErr) {
          return res.status(500).send('<html><body><h1>Error</h1><p>An error occurred</p></body></html>');
        }

        const contributorsList = contributors.map(c => escapeHtml(c.modifiedBy)).join(', ');

        const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(entry.title)}</title>
</head>
<body>
  <h1>${escapeHtml(entry.title)}</h1>
  <p><strong>Last Modified:</strong> ${escapeHtml(entry.lastModifiedAt)}</p>
  <p><strong>Last Modified By:</strong> ${escapeHtml(entry.lastModifiedBy)}</p>
  <p><strong>Contributors:</strong> ${contributorsList}</p>
  <div style="border: 1px solid #ccc; padding: 10px; white-space: pre-wrap;">${escapeHtml(entry.content)}</div>
  
  <h2>Edit Entry</h2>
  <form id="editForm">
    <label>Content: <textarea id="content" required>${escapeHtml(entry.content)}</textarea></label><br>
    <label>Modified By: <input type="text" id="modifiedBy" required></label><br>
    <label>Summary: <input type="text" id="summary" required></label><br>
    <button type="submit">Update</button>
  </form>
  
  <p><a href="/entries/${escapeHtml(entryId)}/edits">View Edit History</a></p>
  <p><a href="/entries">Back to All Entries</a></p>
  
  <script>
    document.getElementById('editForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        content: document.getElementById('content').value,
        modifiedBy: document.getElementById('modifiedBy').value,
        summary: document.getElementById('summary').value
      };
      const response = await fetch('/entries/${escapeHtml(entryId)}', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (response.ok) {
        location.reload();
      } else {
        alert('Error updating entry');
      }
    });
  </script>
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
  try {
    const entryId = req.params.entryId;
    const { content, modifiedBy, summary } = req.body;

    if (!content || !modifiedBy) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
      if (err) {
        return res.status(500).json({ error: 'An error occurred' });
      }

      if (!entry) {
        return res.status(404).json({ error: 'Entry not found' });
      }

      const now = new Date().toISOString();
      const previousContent = entry.content;

      db.run(
        'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
        [content, modifiedBy, now, entryId],
        function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'An error occurred' });
          }

          db.run(
            'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary, previousContent) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [uuidv4(), entryId, content, modifiedBy, now, summary || '', previousContent],
            (editErr) => {
              if (editErr) {
                return res.status(500).json({ error: 'An error occurred' });
              }

              res.json({
                id: entryId,
                title: entry.title,
                content,
                lastModifiedBy: modifiedBy,
                lastModifiedAt: now
              });
            }
          );
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: 'An error occurred' });
  }
});

// GET /entries/:entryId/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
  const entryId = req.params.entryId;

  db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
    if (err) {
      return res.status(500).send('<html><body><h1>Error</h1><p>An error occurred</p></body></html>');
    }

    if (!entry) {
      return res.status(404).send('<html><body><h1>Not Found</h1><p>Entry not found</p></body></html>');
    }

    db.all(
      'SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt DESC',
      [entryId],
      (editErr, edits) => {
        if (editErr) {
          return res.status(500).send('<html><body><h1>Error</h1><p>An error occurred</p></body></html>');
        }

        let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Edit History - ${escapeHtml(entry.title)}</title>
</head>
<body>
  <h1>Edit History - ${escapeHtml(entry.title)}</h1>
  <p><a href="/entries/${escapeHtml(entryId)}">Back to Entry</a></p>
`;

        edits.forEach(edit => {
          const diff = generateDiff(edit.previousContent, edit.content);
          html += `
  <div style="border: 1px solid #ccc; margin: 10px 0; padding: 10px;">
    <p><strong>Modified At:</strong> ${escapeHtml(edit.modifiedAt)}</p>
    <p><strong>Modified By:</strong> ${escapeHtml(edit.modifiedBy)}</p>
    <p><strong>Summary:</strong> ${escapeHtml(edit.summary || 'No summary')}</p>
    <h3>Changes:</h3>
    <div style="font-family: monospace; font-size: 12px; border: 1px solid #ddd; padding: 5px;">
      ${diff}
    </div>
  </div>
`;
        });

        html += `
</body>
</html>
`;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      }
    );
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An error occurred' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    process.exit(err ? 1 : 0);
  });
});
</CODE>