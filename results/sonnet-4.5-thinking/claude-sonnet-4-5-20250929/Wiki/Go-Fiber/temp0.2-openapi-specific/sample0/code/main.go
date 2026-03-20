package main

import (
	"database/sql"
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
	ID         string
	EntryID    string
	Content    string
	ModifiedBy string
	ModifiedAt time.Time
	Summary    string
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS entries (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			created_by TEXT NOT NULL,
			created_at DATETIME NOT NULL,
			last_modified_by TEXT NOT NULL,
			last_modified_at DATETIME NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS edits (
			id TEXT PRIMARY KEY,
			entry_id TEXT NOT NULL,
			content TEXT NOT NULL,
			modified_by TEXT NOT NULL,
			modified_at DATETIME NOT NULL,
			summary TEXT NOT NULL,
			FOREIGN KEY (entry_id) REFERENCES entries(id)
		)
	`)
	return err
}

func securityMiddleware(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	return c.Next()
}

func escapeHTML(s string) string {
	return html.EscapeString(s)
}

func getEntries(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>Wiki Entries</title>
	<meta charset="UTF-8">
</head>
<body>
	<h1>Wiki Entries</h1>
	<ul>
`)

	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			log.Printf("Scan error: %v", err)
			continue
		}
		htmlBuilder.WriteString(fmt.Sprintf(`		<li><a href="/entries/%s">%s</a></li>
`, escapeHTML(id), escapeHTML(title)))
	}

	htmlBuilder.WriteString(`	</ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlBuilder.String())
}

func createEntry(c *fiber.Ctx) error {
	var newEntry NewEntry
	if err := c.BodyParser(&newEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if newEntry.Title == "" || newEntry.Content == "" || newEntry.CreatedBy == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	id := uuid.New().String()
	now := time.Now()

	_, err := db.Exec(
		"INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now, newEntry.CreatedBy, now,
	)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	editID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
		editID, id, newEntry.Content, newEntry.CreatedBy, now, "Initial creation",
	)
	if err != nil {
		log.Printf("Database error: %v", err)
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
		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.Status(404).SendString("Entry not found")
	}
	if err != nil {
		log.Printf("Database error: %v", err)
		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.Status(500).SendString("Internal server error")
	}

	rows, err := db.Query(
		"SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by",
		entryID,
	)

	var contributors []string
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var contributor string
			if err := rows.Scan(&contributor); err == nil {
				contributors = append(contributors, contributor)
			}
		}
	} else {
		log.Printf("Database error fetching contributors: %v", err)
	}

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>`)
	htmlBuilder.WriteString(escapeHTML(entry.Title))
	htmlBuilder.WriteString(`</title>
	<meta charset="UTF-8">
</head>
<body>
	<h1>`)
	htmlBuilder.WriteString(escapeHTML(entry.Title))
	htmlBuilder.WriteString(`</h1>
	<div>`)
	htmlBuilder.WriteString(escapeHTML(entry.Content))
	htmlBuilder.WriteString(`</div>
	<p><strong>Last modified by:</strong> `)
	htmlBuilder.WriteString(escapeHTML(entry.LastModifiedBy))
	htmlBuilder.WriteString(`</p>
	<p><strong>Last modified at:</strong> `)
	htmlBuilder.WriteString(escapeHTML(entry.LastModifiedAt.Format(time.RFC3339)))
	htmlBuilder.WriteString(`</p>
`)

	if len(contributors) > 0 {
		htmlBuilder.WriteString(`	<p><strong>Contributors:</strong></p>
	<ul>
`)
		for _, contributor := range contributors {
			htmlBuilder.WriteString(`		<li>`)
			htmlBuilder.WriteString(escapeHTML(contributor))
			htmlBuilder.WriteString(`</li>
`)
		}
		htmlBuilder.WriteString(`	</ul>
`)
	}

	htmlBuilder.WriteString(`	<p><a href="/entries/`)
	htmlBuilder.WriteString(escapeHTML(entryID))
	htmlBuilder.WriteString(`/edits">View edit history</a></p>
	<p><a href="/entries">Back to all entries</a></p>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlBuilder.String())
}

func updateEntry(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var updateEntry UpdateEntry
	if err := c.BodyParser(&updateEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if updateEntry.Content == "" || updateEntry.ModifiedBy == "" || updateEntry.Summary == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM entries WHERE id = ?)", entryID).Scan(&exists)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
	}

	now := time.Now()

	_, err = db.Exec(
		"UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
		updateEntry.Content, updateEntry.ModifiedBy, now, entryID,
	)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	editID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
		editID, entryID, updateEntry.Content, updateEntry.ModifiedBy, now, updateEntry.Summary,
	)
	if err != nil {
		log.Printf("Database error: %v", err)
	}

	var entry Entry
	err = db.QueryRow(
		"SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?",
		entryID,
	).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)

	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(entry)
}

func getEdits(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var title string
	err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
	if err == sql.ErrNoRows {
		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.Status(404).SendString("Entry not found")
	}
	if err != nil {
		log.Printf("Database error: %v", err)
		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.Status(500).SendString("Internal server error")
	}

	rows, err := db.Query(
		"SELECT id, content, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY modified_at DESC",
		entryID,
	)
	if err != nil {
		log.Printf("Database error: %v", err)
		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var edits []Edit
	for rows.Next() {
		var edit Edit
		if err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &edit.ModifiedAt, &edit.Summary); err != nil {
			log.Printf("Scan error: %v", err)
			continue
		}
		edits = append(edits, edit)
	}

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>Edit History - `)
	htmlBuilder.WriteString(escapeHTML(title))
	htmlBuilder.WriteString(`</title>
	<meta charset="UTF-8">
</head>
<body>
	<h1>Edit History - `)
	htmlBuilder.WriteString(escapeHTML(title))
	htmlBuilder.WriteString(`</h1>
`)

	for i, edit := range edits {
		htmlBuilder.WriteString(`	<div style="border: 1px solid #ccc; margin: 10px 0; padding: 10px;">
		<p><strong>Modified by:</strong> `)
		htmlBuilder.WriteString(escapeHTML(edit.ModifiedBy))
		htmlBuilder.WriteString(`</p>
		<p><strong>Modified at:</strong> `)
		htmlBuilder.WriteString(escapeHTML(edit.ModifiedAt.Format(time.RFC3339)))
		htmlBuilder.WriteString(`</p>
		<p><strong>Summary:</strong> `)
		htmlBuilder.WriteString(escapeHTML(edit.Summary))
		htmlBuilder.WriteString(`</p>
`)

		if i < len(edits)-1 {
			prevContent := edits[i+1].Content
			currContent := edit.Content
			diff := simpleDiff(prevContent, currContent)
			htmlBuilder.WriteString(`		<p><strong>Changes:</strong></p>
		<pre>`)
			htmlBuilder.WriteString(escapeHTML(diff))
			htmlBuilder.WriteString(`</pre>
`)
		} else {
			htmlBuilder.WriteString(`		<p><strong>Content:</strong></p>
		<pre>`)
			htmlBuilder.WriteString(escapeHTML(edit.Content))
			htmlBuilder.WriteString(`</pre>
`)
		}

		htmlBuilder.WriteString(`	</div>
`)
	}

	htmlBuilder.WriteString(`	<p><a href="/entries/`)
	htmlBuilder.WriteString(escapeHTML(entryID))
	htmlBuilder.WriteString(`">Back to entry</a></p>
	<p><a href="/entries">Back to all entries</a></p>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlBuilder.String())
}

func simpleDiff(old, new string) string {
	oldLines := strings.Split(old, "\n")
	newLines := strings.Split(new, "\n")

	var diff strings.Builder

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
				diff.WriteString("- ")
				diff.WriteString(oldLine)
				diff.WriteString("\n")
			}
			if newLine != "" {
				diff.WriteString("+ ")
				diff.WriteString(newLine)
				diff.WriteString("\n")
			}
		}
	}

	if diff.Len() == 0 {
		return "No changes"
	}
	return diff.String()
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			log.Printf("Error: %v", err)
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	app.Use(securityMiddleware)

	app.Get("/entries", getEntries)
	app.Post("/entries", createEntry)
	app.Get("/entries/:entryId", getEntry)
	app.Put("/entries/:entryId", updateEntry)
	app.Get("/entries/:entryId/edits", getEdits)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}