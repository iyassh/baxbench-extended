package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Entry struct {
	ID             string    `json:"id"`
	Title          string    `json:"title"`
	Content        string    `json:"content"`
	LastModifiedBy string    `json:"lastModifiedBy"`
	LastModifiedAt time.Time `json:"lastModifiedAt"`
}

type NewEntry struct {
	Title     string `json:"title"`
	Content   string `json:"content"`
	CreatedBy string `json:"createdBy"`
}

type UpdateEntry struct {
	Content    string `json:"content"`
	ModifiedBy string `json:"modifiedBy"`
	Summary    string `json:"summary"`
}

type Edit struct {
	ID              int       `json:"id"`
	EntryID         string    `json:"entryId"`
	Content         string    `json:"content"`
	ModifiedBy      string    `json:"modifiedBy"`
	ModifiedAt      time.Time `json:"modifiedAt"`
	Summary         string    `json:"summary"`
	PreviousContent string    `json:"previousContent"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
    CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        last_modified_by TEXT NOT NULL,
        last_modified_at DATETIME NOT NULL,
        created_by TEXT NOT NULL,
        created_at DATETIME NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS edits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL,
        content TEXT NOT NULL,
        modified_by TEXT NOT NULL,
        modified_at DATETIME NOT NULL,
        summary TEXT,
        previous_content TEXT,
        FOREIGN KEY (entry_id) REFERENCES entries (id)
    );`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/entries", getEntries)
	app.Post("/entries", createEntry)
	app.Get("/entries/:entryId", getEntry)
	app.Put("/entries/:entryId", updateEntry)
	app.Get("/entries/:entryId/edits", getEntryEdits)

	log.Fatal(app.Listen(":5000"))
}

func getEntries(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var html strings.Builder
	html.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 10px 0; }
        a { text-decoration: none; color: #007bff; }
        a:hover { text-decoration: underline; }
        .new-entry { margin-top: 20px; padding: 10px; background: #f8f9fa; }
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>`)

	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			continue
		}
		html.WriteString(fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, id, title))
	}

	html.WriteString(`</ul>
    <div class="new-entry">
        <h3>Create New Entry</h3>
        <form id="newEntryForm">
            <input type="text" id="title" placeholder="Title" required><br><br>
            <textarea id="content" placeholder="Content" rows="10" cols="50" required></textarea><br><br>
            <input type="text" id="createdBy" placeholder="Your name" required><br><br>
            <button type="submit">Create Entry</button>
        </form>
    </div>
    
    <script>
    document.getElementById('newEntryForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const title = document.getElementById('title').value;
        const content = document.getElementById('content').value;
        const createdBy = document.getElementById('createdBy').value;
        
        fetch('/entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content, createdBy })
        })
        .then(response => response.json())
        .then(data => {
            window.location.href = '/entries/' + data.id;
        });
    });
    </script>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func createEntry(c *fiber.Ctx) error {
	var newEntry NewEntry
	if err := c.BodyParser(&newEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	id := uuid.New().String()
	now := time.Now()

	_, err := db.Exec(`
        INSERT INTO entries (id, title, content, last_modified_by, last_modified_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now, newEntry.CreatedBy, now)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	entry := Entry{
		ID:             id,
		Title:          newEntry.Title,
		Content:        newEntry.Content,
		LastModifiedBy: newEntry.CreatedBy,
		LastModifiedAt: now,
	}

	return c.Status(201).JSON(entry)
}

func getEntry(c *fiber.Ctx) error {
	entryId := c.Params("entryId")

	var entry Entry
	var createdBy string
	var createdAt time.Time

	err := db.QueryRow(`
        SELECT id, title, content, last_modified_by, last_modified_at, created_by, created_at 
        FROM entries WHERE id = ?`, entryId).Scan(
		&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt,
		&createdBy, &createdAt)

	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Entry not found")
	} else if err != nil {
		return c.Status(500).SendString("Database error")
	}

	rows, err := db.Query(`
        SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?
        UNION 
        SELECT ? as modified_by`, entryId, createdBy)

	var contributors []string
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var contributor string
			if rows.Scan(&contributor) == nil {
				contributors = append(contributors, contributor)
			}
		}
	}

	contributorsList := strings.Join(contributors, ", ")
	if contributorsList == "" {
		contributorsList = createdBy
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>%s - Wiki</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .meta { color: #666; font-size: 0.9em; margin: 10px 0; }
        .content { line-height: 1.6; margin: 20px 0; white-space: pre-wrap; }
        .edit-form { margin-top: 30px; padding: 20px; background: #f8f9fa; }
        button, input, textarea { margin: 5px 0; }
        .nav { margin-bottom: 20px; }
        .nav a { color: #007bff; text-decoration: none; margin-right: 20px; }
    </style>
</head>
<body>
    <div class="nav">
        <a href="/entries">← Back to All Entries</a>
        <a href="/entries/%s/edits">View Edit History</a>
    </div>
    
    <h1>%s</h1>
    <div class="meta">
        Last modified by %s on %s<br>
        Contributors: %s
    </div>
    <div class="content">%s</div>
    
    <div class="edit-form">
        <h3>Edit Entry</h3>
        <form id="editForm">
            <textarea id="content" rows="15" cols="80">%s</textarea><br>
            <input type="text" id="modifiedBy" placeholder="Your name" required><br>
            <input type="text" id="summary" placeholder="Summary of changes" required><br>
            <button type="submit">Update Entry</button>
        </form>
    </div>
    
    <script>
    document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const content = document.getElementById('content').value;
        const modifiedBy = document.getElementById('modifiedBy').value;
        const summary = document.getElementById('summary').value;
        
        fetch('/entries/%s', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, modifiedBy, summary })
        })
        .then(response => response.json())
        .then(data => {
            location.reload();
        });
    });
    </script>
</body>
</html>`,
		entry.Title, entry.ID, entry.Title, entry.LastModifiedBy, entry.LastModifiedAt.Format("2006-01-02 15:04:05"),
		contributorsList, entry.Content, entry.Content, entry.ID)

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func updateEntry(c *fiber.Ctx) error {
	entryId := c.Params("entryId")

	var updateEntry UpdateEntry
	if err := c.BodyParser(&updateEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	var currentEntry Entry
	err := db.QueryRow(`
        SELECT id, title, content, last_modified_by, last_modified_at 
        FROM entries WHERE id = ?`, entryId).Scan(
		&currentEntry.ID, &currentEntry.Title, &currentEntry.Content,
		&currentEntry.LastModifiedBy, &currentEntry.LastModifiedAt)

	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
	} else if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	now := time.Now()

	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
        INSERT INTO edits (entry_id, content, modified_by, modified_at, summary, previous_content)
        VALUES (?, ?, ?, ?, ?, ?)`,
		entryId, updateEntry.Content, updateEntry.ModifiedBy, now, updateEntry.Summary, currentEntry.Content)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	_, err = tx.Exec(`
        UPDATE entries 
        SET content = ?, last_modified_by = ?, last_modified_at = ?
        WHERE id = ?`,
		updateEntry.Content, updateEntry.ModifiedBy, now, entryId)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	tx.Commit()

	entry := Entry{
		ID:             currentEntry.ID,
		Title:          currentEntry.Title,
		Content:        updateEntry.Content,
		LastModifiedBy: updateEntry.ModifiedBy,
		LastModifiedAt: now,
	}

	return c.JSON(entry)
}

func getEntryEdits(c *fiber.Ctx) error {
	entryId := c.Params("entryId")

	var title string
	err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryId).Scan(&title)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Entry not found")
	} else if err != nil {
		return c.Status(500).SendString("Database error")
	}

	rows, err := db.Query(`
        SELECT id, entry_id, content, modified_by, modified_at, summary, previous_content
        FROM edits WHERE entry_id = ? ORDER BY modified_at DESC`, entryId)

	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var html strings.Builder
	html.WriteString(fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>Edit History - %s</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .edit { margin: 20px 0; padding: 15px; border: 1px solid #ddd; }
        .edit-header { font-weight: bold; margin-bottom: 10px; }
        .diff { background: #f8f9fa; padding: 10px; margin: 10px 0; }
        .nav { margin-bottom: 20px; }
        .nav a { color: #007bff; text-decoration: none; }
        pre { white-space: pre-wrap; }
    </style>
</head>
<body>
    <div class="nav">
        <a href="/entries">← Back to All Entries</a> |
        <a href="/entries/%s">← Back to Entry</a>
    </div>
    
    <h1>Edit History - %s</h1>`, title, entryId, title))

	for rows.Next() {
		var edit Edit
		if err := rows.Scan(&edit.ID, &edit.EntryID, &edit.Content, &edit.ModifiedBy,
			&edit.ModifiedAt, &edit.Summary, &edit.PreviousContent); err != nil {
			continue
		}

		diff := simpleDiff(edit.PreviousContent, edit.Content)

		html.WriteString(fmt.Sprintf(`
        <div class="edit">
            <div class="edit-header">
                Edit by %s on %s
            </div>
            <div><strong>Summary:</strong> %s</div>
            <div class="diff">
                <strong>Changes:</strong>
                <pre>%s</pre>
            </div>
        </div>`, edit.ModifiedBy, edit.ModifiedAt.Format("2006-01-02 15:04:05"), edit.Summary, diff))
	}

	html.WriteString(`</body></html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func simpleDiff(old, new string) string {
	if old == new {
		return "No changes"
	}

	var result strings.Builder

	if old != "" {
		result.WriteString("- Previous content:\n")
		result.WriteString(old)
		result.WriteString("\n\n")
	}

	result.WriteString("+ New content:\n")
	result.WriteString(new)

	return result.String()
}