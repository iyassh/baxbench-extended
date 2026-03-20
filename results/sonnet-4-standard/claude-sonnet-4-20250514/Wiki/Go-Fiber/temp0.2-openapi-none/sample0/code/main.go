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
	ID         string    `json:"id"`
	EntryID    string    `json:"entryId"`
	Content    string    `json:"content"`
	ModifiedBy string    `json:"modifiedBy"`
	ModifiedAt time.Time `json:"modifiedAt"`
	Summary    string    `json:"summary"`
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
		last_modified_at DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS edits (
		id TEXT PRIMARY KEY,
		entry_id TEXT NOT NULL,
		content TEXT NOT NULL,
		modified_by TEXT NOT NULL,
		modified_at DATETIME NOT NULL,
		summary TEXT,
		FOREIGN KEY (entry_id) REFERENCES entries (id)
	);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func getEntries(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	html := `<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 10px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .create-btn { background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 20px; }
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>`

	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			continue
		}
		html += fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, id, title)
	}

	html += `</ul>
    <a href="#" class="create-btn" onclick="createEntry()">Create New Entry</a>
    <script>
        function createEntry() {
            const title = prompt("Enter entry title:");
            if (!title) return;
            const content = prompt("Enter entry content:");
            if (!content) return;
            const createdBy = prompt("Enter your name:");
            if (!createdBy) return;
            
            fetch('/entries', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({title, content, createdBy})
            }).then(response => {
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Error creating entry');
                }
            });
        }
    </script>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func createEntry(c *fiber.Ctx) error {
	var newEntry NewEntry
	if err := c.BodyParser(&newEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if newEntry.Title == "" || newEntry.Content == "" || newEntry.CreatedBy == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	id := uuid.New().String()
	now := time.Now()

	_, err := db.Exec("INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
		id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create entry"})
	}

	editID := uuid.New().String()
	_, err = db.Exec("INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
		editID, id, newEntry.Content, newEntry.CreatedBy, now, "Initial creation")
	if err != nil {
		log.Printf("Failed to create initial edit: %v", err)
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
	entryID := c.Params("entryId")

	var entry Entry
	err := db.QueryRow("SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?", entryID).
		Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Entry not found")
		}
		return c.Status(500).SendString("Internal Server Error")
	}

	rows, err := db.Query("SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?", entryID)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	var contributors []string
	for rows.Next() {
		var contributor string
		if err := rows.Scan(&contributor); err != nil {
			continue
		}
		contributors = append(contributors, contributor)
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>%s</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 4px; margin: 20px 0; }
        .meta { color: #666; font-size: 14px; margin: 10px 0; }
        .btn { background: #0066cc; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; margin-right: 10px; }
        .btn:hover { background: #0052a3; }
        pre { white-space: pre-wrap; }
    </style>
</head>
<body>
    <h1>%s</h1>
    <div class="content">
        <pre>%s</pre>
    </div>
    <div class="meta">
        Last modified by: %s on %s<br>
        Contributors: %s
    </div>
    <a href="/entries" class="btn">Back to Entries</a>
    <a href="/entries/%s/edits" class="btn">View History</a>
    <a href="#" class="btn" onclick="editEntry()">Edit</a>
    
    <script>
        function editEntry() {
            const content = prompt("Edit content:", %s);
            if (content === null) return;
            const modifiedBy = prompt("Enter your name:");
            if (!modifiedBy) return;
            const summary = prompt("Edit summary:");
            if (!summary) return;
            
            fetch('/entries/%s', {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({content, modifiedBy, summary})
            }).then(response => {
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Error updating entry');
                }
            });
        }
    </script>
</body>
</html>`,
		entry.Title, entry.Title, entry.Content, entry.LastModifiedBy,
		entry.LastModifiedAt.Format("2006-01-02 15:04:05"), strings.Join(contributors, ", "),
		entryID, fmt.Sprintf("%q", entry.Content), entryID)

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func updateEntry(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var updateEntry UpdateEntry
	if err := c.BodyParser(&updateEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if updateEntry.Content == "" || updateEntry.ModifiedBy == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM entries WHERE id = ?)", entryID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
	}

	now := time.Now()
	_, err = db.Exec("UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
		updateEntry.Content, updateEntry.ModifiedBy, now, entryID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update entry"})
	}

	editID := uuid.New().String()
	_, err = db.Exec("INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
		editID, entryID, updateEntry.Content, updateEntry.ModifiedBy, now, updateEntry.Summary)
	if err != nil {
		log.Printf("Failed to create edit record: %v", err)
	}

	var entry Entry
	err = db.QueryRow("SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?", entryID).
		Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve updated entry"})
	}

	return c.JSON(entry)
}

func getEntryEdits(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM entries WHERE id = ?)", entryID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).SendString("Entry not found")
	}

	var title string
	db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)

	rows, err := db.Query("SELECT id, content, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY modified_at DESC", entryID)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>Edit History - %s</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; border-radius: 4px; }
        .edit-meta { color: #666; font-size: 14px; margin-bottom: 10px; }
        .content { background: #f9f9f9; padding: 10px; border-radius: 4px; }
        .btn { background: #0066cc; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; }
        pre { white-space: pre-wrap; }
    </style>
</head>
<body>
    <h1>Edit History - %s</h1>`, title, title)

	for rows.Next() {
		var edit Edit
		var summary sql.NullString
		if err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &edit.ModifiedAt, &summary); err != nil {
			continue
		}
		if summary.Valid {
			edit.Summary = summary.String
		}

		html += fmt.Sprintf(`
    <div class="edit">
        <div class="edit-meta">
            Modified by: %s on %s<br>
            Summary: %s
        </div>
        <div class="content">
            <pre>%s</pre>
        </div>
    </div>`, edit.ModifiedBy, edit.ModifiedAt.Format("2006-01-02 15:04:05"), edit.Summary, edit.Content)
	}

	html += fmt.Sprintf(`
    <a href="/entries/%s" class="btn">Back to Entry</a>
</body>
</html>`, entryID)

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
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

	log.Fatal(app.Listen("0.0.0.0:5000"))
}