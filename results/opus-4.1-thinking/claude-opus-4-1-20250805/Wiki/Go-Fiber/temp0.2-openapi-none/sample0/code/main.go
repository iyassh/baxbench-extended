package main

import (
	"database/sql"
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
	ID         string
	EntryID    string
	Content    string
	ModifiedBy string
	ModifiedAt time.Time
	Summary    string
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
		FOREIGN KEY (entry_id) REFERENCES entries(id)
	);
	`
	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	// GET /entries
	app.Get("/entries", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, title FROM entries ORDER BY last_modified_at DESC")
		if err != nil {
			return c.Status(500).SendString("Error fetching entries")
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
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>`

		for rows.Next() {
			var id, title string
			err := rows.Scan(&id, &title)
			if err != nil {
				continue
			}
			html += fmt.Sprintf(`
        <li><a href="/entries/%s">%s</a></li>`, id, title)
		}

		html += `
    </ul>
</body>
</html>`

		c.Set("Content-Type", "text/html")
		return c.SendString(html)
	})

	// POST /entries
	app.Post("/entries", func(c *fiber.Ctx) error {
		var newEntry NewEntry
		if err := c.BodyParser(&newEntry); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		entryID := uuid.New().String()
		now := time.Now()

		_, err := db.Exec(
			"INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
			entryID, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now,
		)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create entry"})
		}

		editID := uuid.New().String()
		_, err = db.Exec(
			"INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
			editID, entryID, newEntry.Content, newEntry.CreatedBy, now, "Initial creation",
		)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create edit record"})
		}

		entry := Entry{
			ID:             entryID,
			Title:          newEntry.Title,
			Content:        newEntry.Content,
			LastModifiedBy: newEntry.CreatedBy,
			LastModifiedAt: now,
		}

		return c.Status(201).JSON(entry)
	})

	// GET /entries/{entryId}
	app.Get("/entries/:entryId", func(c *fiber.Ctx) error {
		entryID := c.Params("entryId")

		var entry Entry
		err := db.QueryRow(
			"SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?",
			entryID,
		).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)

		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Entry not found")
		}
		if err != nil {
			return c.Status(500).SendString("Error fetching entry")
		}

		rows, err := db.Query(
			"SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by",
			entryID,
		)
		if err != nil {
			return c.Status(500).SendString("Error fetching contributors")
		}
		defer rows.Close()

		var contributors []string
		for rows.Next() {
			var contributor string
			if err := rows.Scan(&contributor); err == nil {
				contributors = append(contributors, contributor)
			}
		}

		html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>%s - Wiki Entry</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .meta { color: #666; font-size: 14px; margin: 10px 0; }
        .content { background: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0; white-space: pre-wrap; }
        .contributors { margin: 20px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>%s</h1>
    <div class="meta">Last edited: %s by %s</div>
    <div class="content">%s</div>
    <div class="contributors">
        <strong>Contributors:</strong> %s
    </div>
    <div>
        <a href="/entries/%s/edits">View Edit History</a> | 
        <a href="/entries">Back to All Entries</a>
    </div>
</body>
</html>`, entry.Title, entry.Title, entry.LastModifiedAt.Format("2006-01-02 15:04:05"),
			entry.LastModifiedBy, entry.Content, strings.Join(contributors, ", "), entry.ID)

		c.Set("Content-Type", "text/html")
		return c.SendString(html)
	})

	// PUT /entries/{entryId}
	app.Put("/entries/:entryId", func(c *fiber.Ctx) error {
		entryID := c.Params("entryId")

		var updateEntry UpdateEntry
		if err := c.BodyParser(&updateEntry); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		var existingTitle string
		err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&existingTitle)
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
		}
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}

		now := time.Now()

		_, err = db.Exec(
			"UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
			updateEntry.Content, updateEntry.ModifiedBy, now, entryID,
		)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to update entry"})
		}

		editID := uuid.New().String()
		_, err = db.Exec(
			"INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
			editID, entryID, updateEntry.Content, updateEntry.ModifiedBy, now, updateEntry.Summary,
		)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create edit record"})
		}

		entry := Entry{
			ID:             entryID,
			Title:          existingTitle,
			Content:        updateEntry.Content,
			LastModifiedBy: updateEntry.ModifiedBy,
			LastModifiedAt: now,
		}

		return c.JSON(entry)
	})

	// GET /entries/{entryId}/edits
	app.Get("/entries/:entryId/edits", func(c *fiber.Ctx) error {
		entryID := c.Params("entryId")

		var entryTitle string
		err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&entryTitle)
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Entry not found")
		}
		if err != nil {
			return c.Status(500).SendString("Error fetching entry")
		}

		rows, err := db.Query(
			"SELECT id, content, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY modified_at DESC",
			entryID,
		)
		if err != nil {
			return c.Status(500).SendString("Error fetching edit history")
		}
		defer rows.Close()

		var edits []Edit
		for rows.Next() {
			var edit Edit
			err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &edit.ModifiedAt, &edit.Summary)
			if err == nil {
				edit.EntryID = entryID
				edits = append(edits, edit)
			}
		}

		html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>Edit History - %s</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; border-radius: 5px; }
        .edit-header { background: #f5f5f5; padding: 10px; margin: -15px -15px 10px -15px; border-radius: 5px 5px 0 0; }
        .edit-meta { color: #666; font-size: 14px; }
        .edit-summary { margin: 10px 0; font-style: italic; }
        .edit-content { background: #fafafa; padding: 10px; border-left: 3px solid #4CAF50; font-family: monospace; white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
        .diff { margin-top: 10px; padding: 10px; background: #fff; border: 1px solid #ddd; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: %s</h1>
    <div><a href="/entries/%s">Back to Entry</a> | <a href="/entries">All Entries</a></div>`,
			entryTitle, entryTitle, entryID)

		prevContent := ""
		for i := len(edits) - 1; i >= 0; i-- {
			edit := edits[i]

			diffText := ""
			if i == len(edits)-1 {
				diffText = "Initial version"
			} else if prevContent != edit.Content {
				if len(prevContent) > 100 {
					diffText = fmt.Sprintf("Changed from: %.100s... to current content", prevContent)
				} else {
					diffText = fmt.Sprintf("Changed from: %s", prevContent)
				}
			}

			html += fmt.Sprintf(`
    <div class="edit">
        <div class="edit-header">
            <div class="edit-meta">
                <strong>%s</strong> edited on %s
            </div>
            <div class="edit-summary">Summary: %s</div>
        </div>
        <div class="edit-content">%s</div>`,
				edit.ModifiedBy, edit.ModifiedAt.Format("2006-01-02 15:04:05"),
				edit.Summary, edit.Content)

			if diffText != "" {
				html += fmt.Sprintf(`
        <div class="diff">Diff: %s</div>`, diffText)
			}

			html += `
    </div>`

			prevContent = edit.Content
		}

		html += `
</body>
</html>`

		c.Set("Content-Type", "text/html")
		return c.SendString(html)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}