package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
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
	ID              string
	EntryID         string
	Content         string
	PreviousContent string
	ModifiedBy      string
	ModifiedAt      time.Time
	Summary         string
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
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
		previous_content TEXT,
		modified_by TEXT NOT NULL,
		modified_at DATETIME NOT NULL,
		summary TEXT,
		FOREIGN KEY (entry_id) REFERENCES entries(id)
	);

	CREATE INDEX IF NOT EXISTS idx_edits_entry_id ON edits(entry_id);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func getEntriesHandler(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	htmlContent := `<!DOCTYPE html>
<html>
<head>
	<title>Wiki Entries</title>
	<style>
		body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
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
		safeTitle := html.EscapeString(title)
		safeID := html.EscapeString(id)
		htmlContent += fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, safeID, safeTitle)
	}

	htmlContent += `</ul></body></html>`
	c.Set("Content-Type", "text/html")
	return c.SendString(htmlContent)
}

func createEntryHandler(c *fiber.Ctx) error {
	var newEntry NewEntry
	if err := c.BodyParser(&newEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if newEntry.Title == "" || newEntry.Content == "" || newEntry.CreatedBy == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	id := uuid.New().String()
	now := time.Now()

	_, err := db.Exec(`
		INSERT INTO entries (id, title, content, last_modified_by, last_modified_at)
		VALUES (?, ?, ?, ?, ?)
	`, id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create entry"})
	}

	editID := uuid.New().String()
	_, err = db.Exec(`
		INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, editID, id, newEntry.Content, "", newEntry.CreatedBy, now, "Initial creation")

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to record edit"})
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

func getEntryHandler(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var entry Entry
	err := db.QueryRow(`
		SELECT id, title, content, last_modified_by, last_modified_at
		FROM entries WHERE id = ?
	`, entryID).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)

	if err == sql.ErrNoRows {
		c.Set("Content-Type", "text/html")
		return c.Status(404).SendString("<html><body><h1>Entry not found</h1></body></html>")
	} else if err != nil {
		return c.Status(500).SendString("Database error")
	}

	rows, err := db.Query(`
		SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?
		ORDER BY modified_by
	`, entryID)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var contributors []string
	for rows.Next() {
		var contributor string
		if err := rows.Scan(&contributor); err == nil {
			contributors = append(contributors, contributor)
		}
	}

	safeTitle := html.EscapeString(entry.Title)
	safeContent := html.EscapeString(entry.Content)
	safeLastModifiedBy := html.EscapeString(entry.LastModifiedBy)
	safeID := html.EscapeString(entry.ID)

	htmlContent := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<title>%s</title>
	<style>
		body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
		h1 { color: #333; }
		.content { background: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap; }
		.metadata { color: #666; margin-top: 20px; font-size: 0.9em; }
		.contributors { margin-top: 10px; }
		a { color: #0066cc; text-decoration: none; }
		a:hover { text-decoration: underline; }
	</style>
</head>
<body>
	<h1>%s</h1>
	<div class="content">%s</div>
	<div class="metadata">
		<p>Last modified by: %s on %s</p>
		<div class="contributors">
			<strong>Contributors:</strong> %s
		</div>
		<p><a href="/entries/%s/edits">View edit history</a> | <a href="/entries">Back to all entries</a></p>
	</div>
</body>
</html>`, safeTitle, safeTitle, safeContent, safeLastModifiedBy, 
		entry.LastModifiedAt.Format("2006-01-02 15:04:05"),
		html.EscapeString(strings.Join(contributors, ", ")), safeID)

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlContent)
}

func updateEntryHandler(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var updateEntry UpdateEntry
	if err := c.BodyParser(&updateEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if updateEntry.Content == "" || updateEntry.ModifiedBy == "" || updateEntry.Summary == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	var currentContent, title string
	err := db.QueryRow("SELECT content, title FROM entries WHERE id = ?", entryID).Scan(&currentContent, &title)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
	} else if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	now := time.Now()

	_, err = db.Exec(`
		UPDATE entries 
		SET content = ?, last_modified_by = ?, last_modified_at = ?
		WHERE id = ?
	`, updateEntry.Content, updateEntry.ModifiedBy, now, entryID)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update entry"})
	}

	editID := uuid.New().String()
	_, err = db.Exec(`
		INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, editID, entryID, updateEntry.Content, currentContent, updateEntry.ModifiedBy, now, updateEntry.Summary)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to record edit"})
	}

	entry := Entry{
		ID:             entryID,
		Title:          title,
		Content:        updateEntry.Content,
		LastModifiedBy: updateEntry.ModifiedBy,
		LastModifiedAt: now,
	}

	return c.JSON(entry)
}

func getEditsHandler(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var title string
	err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
	if err == sql.ErrNoRows {
		c.Set("Content-Type", "text/html")
		return c.Status(404).SendString("<html><body><h1>Entry not found</h1></body></html>")
	} else if err != nil {
		return c.Status(500).SendString("Database error")
	}

	rows, err := db.Query(`
		SELECT id, content, previous_content, modified_by, modified_at, summary
		FROM edits WHERE entry_id = ?
		ORDER BY modified_at DESC
	`, entryID)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	safeTitle := html.EscapeString(title)
	safeID := html.EscapeString(entryID)

	htmlContent := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<title>Edit History - %s</title>
	<style>
		body { font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; }
		h1 { color: #333; }
		.edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; border-radius: 5px; }
		.edit-header { background: #f5f5f5; margin: -15px -15px 15px -15px; padding: 10px 15px; border-radius: 5px 5px 0 0; }
		.diff { background: #f9f9f9; padding: 10px; border-radius: 3px; margin-top: 10px; font-family: monospace; white-space: pre-wrap; }
		.added { background-color: #e6ffed; }
		.removed { background-color: #ffebe9; }
		a { color: #0066cc; text-decoration: none; }
		a:hover { text-decoration: underline; }
	</style>
</head>
<body>
	<h1>Edit History: %s</h1>
	<p><a href="/entries/%s">Back to entry</a> | <a href="/entries">Back to all entries</a></p>`, 
		safeTitle, safeTitle, safeID)

	for rows.Next() {
		var edit Edit
		if err := rows.Scan(&edit.ID, &edit.Content, &edit.PreviousContent, &edit.ModifiedBy, &edit.ModifiedAt, &edit.Summary); err != nil {
			continue
		}

		safeModifiedBy := html.EscapeString(edit.ModifiedBy)
		safeSummary := html.EscapeString(edit.Summary)
		
		diff := generateDiff(edit.PreviousContent, edit.Content)

		htmlContent += fmt.Sprintf(`
	<div class="edit">
		<div class="edit-header">
			<strong>%s</strong> - %s<br>
			Summary: %s
		</div>
		<div class="diff">%s</div>
	</div>`, safeModifiedBy, edit.ModifiedAt.Format("2006-01-02 15:04:05"), safeSummary, diff)
	}

	htmlContent += `</body></html>`
	c.Set("Content-Type", "text/html")
	return c.SendString(htmlContent)
}

func generateDiff(oldContent, newContent string) string {
	if oldContent == "" {
		return fmt.Sprintf(`<span class="added">+ %s</span>`, html.EscapeString(newContent))
	}
	
	oldLines := strings.Split(oldContent, "\n")
	newLines := strings.Split(newContent, "\n")
	
	var diff string
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
			if oldLine != "" {
				diff += fmt.Sprintf(`<span class="removed">- %s</span>`+"\n", html.EscapeString(oldLine))
			}
			if newLine != "" {
				diff += fmt.Sprintf(`<span class="added">+ %s</span>`+"\n", html.EscapeString(newLine))
			}
		} else if oldLine != "" {
			diff += fmt.Sprintf("  %s\n", html.EscapeString(oldLine))
		}
	}
	
	return diff
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/entries", getEntriesHandler)
	app.Post("/entries", createEntryHandler)
	app.Get("/entries/:entryId", getEntryHandler)
	app.Put("/entries/:entryId", updateEntryHandler)
	app.Get("/entries/:entryId/edits", getEditsHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}