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

func getEntries(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
	if err != nil {
		return c.Status(500).SendString("Database error")
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
		if err := rows.Scan(&id, &title); err != nil {
			continue
		}
		html += fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, id, title)
	}

	html += `</ul></body></html>`
	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func createEntry(c *fiber.Ctx) error {
	var newEntry NewEntry
	if err := c.BodyParser(&newEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	id := uuid.New().String()
	now := time.Now()

	_, err := db.Exec(
		"INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
		id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create entry"})
	}

	editID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
		editID, id, newEntry.Content, newEntry.CreatedBy, now, "Initial creation",
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create edit history"})
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
	err := db.QueryRow(
		"SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?",
		entryID,
	).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)

	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Entry not found")
	}
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	rows, err := db.Query(
		"SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by",
		entryID,
	)
	if err != nil {
		return c.Status(500).SendString("Database error")
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
        .content { margin: 20px 0; line-height: 1.6; white-space: pre-wrap; }
        .metadata { color: #666; font-size: 0.9em; margin: 20px 0; }
        .contributors { margin: 10px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>%s</h1>
    <div class="content">%s</div>
    <div class="metadata">
        <p>Last modified by: %s</p>
        <p>Last modified at: %s</p>
        <div class="contributors">
            <strong>Contributors:</strong> %s
        </div>
        <p><a href="/entries/%s/edits">View edit history</a></p>
        <p><a href="/entries">Back to all entries</a></p>
    </div>
</body>
</html>`,
		entry.Title,
		entry.Title,
		entry.Content,
		entry.LastModifiedBy,
		entry.LastModifiedAt.Format("2006-01-02 15:04:05"),
		strings.Join(contributors, ", "),
		entry.ID,
	)

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func updateEntry(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var updateEntry UpdateEntry
	if err := c.BodyParser(&updateEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM entries WHERE id = ?)", entryID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
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
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create edit history"})
	}

	var entry Entry
	err = db.QueryRow(
		"SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?",
		entryID,
	).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve updated entry"})
	}

	return c.JSON(entry)
}

func getEditHistory(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var title string
	err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Entry not found")
	}
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	rows, err := db.Query(
		"SELECT id, content, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY modified_at DESC",
		entryID,
	)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var edits []Edit
	for rows.Next() {
		var edit Edit
		if err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &edit.ModifiedAt, &edit.Summary); err != nil {
			continue
		}
		edit.EntryID = entryID
		edits = append(edits, edit)
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>Edit History - %s</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; border-radius: 5px; }
        .edit-header { background-color: #f5f5f5; margin: -15px -15px 15px -15px; padding: 10px 15px; border-radius: 5px 5px 0 0; }
        .edit-content { white-space: pre-wrap; background-color: #f9f9f9; padding: 10px; border-radius: 3px; margin: 10px 0; }
        .diff { margin: 10px 0; }
        .added { background-color: #e6ffed; color: #24292e; }
        .removed { background-color: #ffeef0; color: #24292e; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: %s</h1>
    <p><a href="/entries/%s">Back to entry</a> | <a href="/entries">Back to all entries</a></p>`,
		title, title, entryID)

	for i, edit := range edits {
		var diff string
		if i < len(edits)-1 {
			prevContent := edits[i+1].Content
			diff = generateSimpleDiff(prevContent, edit.Content)
		} else {
			diff = fmt.Sprintf(`<div class="added">%s</div>`, edit.Content)
		}

		html += fmt.Sprintf(`
    <div class="edit">
        <div class="edit-header">
            <strong>Modified by:</strong> %s<br>
            <strong>Date:</strong> %s<br>
            <strong>Summary:</strong> %s
        </div>
        <div class="diff">
            <strong>Changes:</strong>
            <div class="edit-content">%s</div>
        </div>
    </div>`,
			edit.ModifiedBy,
			edit.ModifiedAt.Format("2006-01-02 15:04:05"),
			edit.Summary,
			diff,
		)
	}

	html += `</body></html>`
	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func generateSimpleDiff(old, new string) string {
	if old == new {
		return "No changes"
	}
	
	oldLines := strings.Split(old, "\n")
	newLines := strings.Split(new, "\n")
	
	var result strings.Builder
	maxLen := len(oldLines)
	if len(newLines) > maxLen {
		maxLen = len(newLines)
	}
	
	for i := 0; i < maxLen; i++ {
		var oldLine, newLine string
		if i < len(oldLines) {
			oldLine = oldLines[i]
		}
		if i < len(newLines) {
			newLine = newLines[i]
		}
		
		if oldLine != newLine {
			if oldLine != "" && newLine == "" {
				result.WriteString(fmt.Sprintf(`<div class="removed">- %s</div>`, oldLine))
			} else if oldLine == "" && newLine != "" {
				result.WriteString(fmt.Sprintf(`<div class="added">+ %s</div>`, newLine))
			} else if oldLine != "" && newLine != "" {
				result.WriteString(fmt.Sprintf(`<div class="removed">- %s</div>`, oldLine))
				result.WriteString(fmt.Sprintf(`<div class="added">+ %s</div>`, newLine))
			}
		} else if oldLine != "" {
			result.WriteString(fmt.Sprintf(`<div>  %s</div>`, oldLine))
		}
	}
	
	return result.String()
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/entries", getEntries)
	app.Post("/entries", createEntry)
	app.Get("/entries/:entryId", getEntry)
	app.Put("/entries/:entryId", updateEntry)
	app.Get("/entries/:entryId/edits", getEditHistory)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}