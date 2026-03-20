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
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
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
	Summary    string    `json:"summary"`
	CreatedAt  time.Time `json:"createdAt"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createEntriesTable := `
	CREATE TABLE IF NOT EXISTS entries (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		last_modified_by TEXT NOT NULL,
		last_modified_at DATETIME NOT NULL
	);`

	createEditsTable := `
	CREATE TABLE IF NOT EXISTS edits (
		id TEXT PRIMARY KEY,
		entry_id TEXT NOT NULL,
		content TEXT NOT NULL,
		modified_by TEXT NOT NULL,
		summary TEXT,
		created_at DATETIME NOT NULL,
		FOREIGN KEY(entry_id) REFERENCES entries(id)
	);`

	if _, err := db.Exec(createEntriesTable); err != nil {
		return err
	}

	if _, err := db.Exec(createEditsTable); err != nil {
		return err
	}

	return nil
}

func sanitizeHTML(input string) string {
	return html.EscapeString(input)
}

func getEntries(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
	if err != nil {
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var htmlContent strings.Builder
	htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <meta charset="UTF-8">
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>`)

	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			continue
		}
		htmlContent.WriteString(fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, 
			sanitizeHTML(id), sanitizeHTML(title)))
	}

	htmlContent.WriteString(`</ul>
    <h2>Create New Entry</h2>
    <form method="POST" action="/entries">
        <input type="hidden" name="_token" value="csrf-token">
        <div>
            <label>Title: <input type="text" name="title" required></label>
        </div>
        <div>
            <label>Content: <textarea name="content" required></textarea></label>
        </div>
        <div>
            <label>Created By: <input type="text" name="createdBy" required></label>
        </div>
        <button type="submit">Create Entry</button>
    </form>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent.String())
}

func createEntry(c *fiber.Ctx) error {
	var newEntry NewEntry
	if err := c.BodyParser(&newEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if newEntry.Title == "" || newEntry.Content == "" || newEntry.CreatedBy == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	id := uuid.New().String()
	now := time.Now()

	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer tx.Rollback()

	_, err = tx.Exec("INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
		id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	editID := uuid.New().String()
	_, err = tx.Exec("INSERT INTO edits (id, entry_id, content, modified_by, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		editID, id, newEntry.Content, newEntry.CreatedBy, "Initial creation", now)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
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
	if entryID == "" {
		return c.Status(400).SendString("Invalid entry ID")
	}

	var entry Entry
	err := db.QueryRow("SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?", entryID).
		Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Entry not found")
		}
		return c.Status(500).SendString("Internal server error")
	}

	rows, err := db.Query("SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?", entryID)
	if err != nil {
		return c.Status(500).SendString("Internal server error")
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

	var htmlContent strings.Builder
	htmlContent.WriteString(fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>%s</title>
    <meta charset="UTF-8">
</head>
<body>
    <h1>%s</h1>
    <div>%s</div>
    <p><strong>Last modified by:</strong> %s on %s</p>
    <p><strong>Contributors:</strong> %s</p>
    <p><a href="/entries">Back to entries</a> | <a href="/entries/%s/edits">View edit history</a></p>
    
    <h2>Edit Entry</h2>
    <form method="PUT" action="/entries/%s">
        <input type="hidden" name="_token" value="csrf-token">
        <div>
            <label>Content: <textarea name="content" required>%s</textarea></label>
        </div>
        <div>
            <label>Modified By: <input type="text" name="modifiedBy" required></label>
        </div>
        <div>
            <label>Summary: <input type="text" name="summary" required></label>
        </div>
        <button type="submit">Update Entry</button>
    </form>
</body>
</html>`,
		sanitizeHTML(entry.Title),
		sanitizeHTML(entry.Title),
		sanitizeHTML(entry.Content),
		sanitizeHTML(entry.LastModifiedBy),
		entry.LastModifiedAt.Format("2006-01-02 15:04:05"),
		sanitizeHTML(strings.Join(contributors, ", ")),
		sanitizeHTML(entry.ID),
		sanitizeHTML(entry.ID),
		sanitizeHTML(entry.Content)))

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent.String())
}

func updateEntry(c *fiber.Ctx) error {
	entryID := c.Params("entryId")
	if entryID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid entry ID"})
	}

	var updateEntry UpdateEntry
	if err := c.BodyParser(&updateEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if updateEntry.Content == "" || updateEntry.ModifiedBy == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer tx.Rollback()

	var exists bool
	err = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM entries WHERE id = ?)", entryID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
	}

	now := time.Now()
	_, err = tx.Exec("UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
		updateEntry.Content, updateEntry.ModifiedBy, now, entryID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	editID := uuid.New().String()
	_, err = tx.Exec("INSERT INTO edits (id, entry_id, content, modified_by, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		editID, entryID, updateEntry.Content, updateEntry.ModifiedBy, updateEntry.Summary, now)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	var entry Entry
	err = db.QueryRow("SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?", entryID).
		Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(entry)
}

func getEntryEdits(c *fiber.Ctx) error {
	entryID := c.Params("entryId")
	if entryID == "" {
		return c.Status(400).SendString("Invalid entry ID")
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM entries WHERE id = ?)", entryID).Scan(&exists)
	if err != nil {
		return c.Status(500).SendString("Internal server error")
	}
	if !exists {
		return c.Status(404).SendString("Entry not found")
	}

	rows, err := db.Query("SELECT id, content, modified_by, summary, created_at FROM edits WHERE entry_id = ? ORDER BY created_at DESC", entryID)
	if err != nil {
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var htmlContent strings.Builder
	htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Edit History</title>
    <meta charset="UTF-8">
</head>
<body>
    <h1>Edit History</h1>
    <p><a href="/entries">Back to entries</a></p>
    <div>`)

	for rows.Next() {
		var edit Edit
		var summary sql.NullString
		if err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &summary, &edit.CreatedAt); err != nil {
			continue
		}
		if summary.Valid {
			edit.Summary = summary.String
		}

		htmlContent.WriteString(fmt.Sprintf(`
        <div style="border: 1px solid #ccc; margin: 10px 0; padding: 10px;">
            <h3>Edit by %s on %s</h3>
            <p><strong>Summary:</strong> %s</p>
            <div style="background: #f5f5f5; padding: 10px;">
                <pre>%s</pre>
            </div>
        </div>`,
			sanitizeHTML(edit.ModifiedBy),
			edit.CreatedAt.Format("2006-01-02 15:04:05"),
			sanitizeHTML(edit.Summary),
			sanitizeHTML(edit.Content)))
	}

	htmlContent.WriteString(`</div>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent.String())
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(500).SendString("Internal server error")
		},
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';",
	}))

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,PUT,DELETE",
		AllowHeaders: "Origin, Content-Type, Accept",
	}))

	app.Get("/entries", getEntries)
	app.Post("/entries", createEntry)
	app.Get("/entries/:entryId", getEntry)
	app.Put("/entries/:entryId", updateEntry)
	app.Get("/entries/:entryId/edits", getEntryEdits)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}