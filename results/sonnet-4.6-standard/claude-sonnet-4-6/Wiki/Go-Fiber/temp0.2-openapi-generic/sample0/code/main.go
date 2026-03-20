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

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createEntries := `
	CREATE TABLE IF NOT EXISTS entries (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		last_modified_by TEXT NOT NULL,
		last_modified_at DATETIME NOT NULL
	);`

	createEdits := `
	CREATE TABLE IF NOT EXISTS edits (
		id TEXT PRIMARY KEY,
		entry_id TEXT NOT NULL,
		content TEXT NOT NULL,
		modified_by TEXT NOT NULL,
		modified_at DATETIME NOT NULL,
		summary TEXT NOT NULL,
		FOREIGN KEY (entry_id) REFERENCES entries(id)
	);`

	if _, err = db.Exec(createEntries); err != nil {
		log.Fatal(err)
	}
	if _, err = db.Exec(createEdits); err != nil {
		log.Fatal(err)
	}
}

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

func computeDiff(oldContent, newContent string) string {
	oldLines := strings.Split(oldContent, "\n")
	newLines := strings.Split(newContent, "\n")

	var sb strings.Builder
	oldSet := make(map[string]bool)
	newSet := make(map[string]bool)

	for _, l := range oldLines {
		oldSet[l] = true
	}
	for _, l := range newLines {
		newSet[l] = true
	}

	for _, l := range oldLines {
		if !newSet[l] {
			sb.WriteString(fmt.Sprintf("<span style='color:red'>- %s</span><br>", html.EscapeString(l)))
		} else {
			sb.WriteString(fmt.Sprintf("<span>  %s</span><br>", html.EscapeString(l)))
		}
	}
	for _, l := range newLines {
		if !oldSet[l] {
			sb.WriteString(fmt.Sprintf("<span style='color:green'>+ %s</span><br>", html.EscapeString(l)))
		}
	}

	return sb.String()
}

func getEntries(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM entries ORDER BY last_modified_at DESC")
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html>
<head><title>Wiki - All Entries</title></head>
<body>
<h1>Wiki Entries</h1>
<ul>`)

	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		sb.WriteString(fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, html.EscapeString(id), html.EscapeString(title)))
	}

	sb.WriteString(`</ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(sb.String())
}

func createEntry(c *fiber.Ctx) error {
	var newEntry NewEntry
	if err := c.BodyParser(&newEntry); err != nil {
		return c.Status(400).SendString("Bad Request")
	}

	if strings.TrimSpace(newEntry.Title) == "" || strings.TrimSpace(newEntry.Content) == "" || strings.TrimSpace(newEntry.CreatedBy) == "" {
		return c.Status(400).SendString("title, content, and createdBy are required")
	}

	id := uuid.New().String()
	now := time.Now().UTC()

	_, err := db.Exec(
		"INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
		id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now,
	)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	// Also record the initial edit
	editID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
		editID, id, newEntry.Content, newEntry.CreatedBy, now, "Initial creation",
	)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
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
		return c.Status(500).SendString("Internal Server Error")
	}

	// Get contributors
	rows, err := db.Query("SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?", entryID)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	var contributors []string
	for rows.Next() {
		var contributor string
		if err := rows.Scan(&contributor); err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		contributors = append(contributors, contributor)
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><title>Wiki - %s</title></head>
<body>
<h1>%s</h1>
<p><strong>Last edited by:</strong> %s</p>
<p><strong>Last edited at:</strong> %s</p>
<p><strong>Contributors:</strong> %s</p>
<hr>
<div>%s</div>
<hr>
<p><a href="/entries/%s/edits">View edit history</a></p>
<p><a href="/entries">Back to all entries</a></p>
</body>
</html>`,
		html.EscapeString(entry.Title),
		html.EscapeString(entry.Title),
		html.EscapeString(entry.LastModifiedBy),
		entry.LastModifiedAt.Format(time.RFC3339),
		html.EscapeString(strings.Join(contributors, ", ")),
		html.EscapeString(entry.Content),
		html.EscapeString(entry.ID),
	))

	c.Set("Content-Type", "text/html")
	return c.SendString(sb.String())
}

func updateEntry(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var updateData UpdateEntry
	if err := c.BodyParser(&updateData); err != nil {
		return c.Status(400).SendString("Bad Request")
	}

	if strings.TrimSpace(updateData.Content) == "" || strings.TrimSpace(updateData.ModifiedBy) == "" {
		return c.Status(400).SendString("content and modifiedBy are required")
	}

	var entry Entry
	err := db.QueryRow(
		"SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?",
		entryID,
	).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)

	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Entry not found")
	}
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	now := time.Now().UTC()
	summary := updateData.Summary
	if strings.TrimSpace(summary) == "" {
		summary = "No summary provided"
	}

	_, err = db.Exec(
		"UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
		updateData.Content, updateData.ModifiedBy, now, entryID,
	)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	editID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
		editID, entryID, updateData.Content, updateData.ModifiedBy, now, summary,
	)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	entry.Content = updateData.Content
	entry.LastModifiedBy = updateData.ModifiedBy
	entry.LastModifiedAt = now

	return c.Status(200).JSON(entry)
}

func getEntryEdits(c *fiber.Ctx) error {
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
		return c.Status(500).SendString("Internal Server Error")
	}

	rows, err := db.Query(
		"SELECT id, entry_id, content, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY modified_at ASC",
		entryID,
	)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	var edits []Edit
	for rows.Next() {
		var edit Edit
		if err := rows.Scan(&edit.ID, &edit.EntryID, &edit.Content, &edit.ModifiedBy, &edit.ModifiedAt, &edit.Summary); err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		edits = append(edits, edit)
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><title>Wiki - Edit History for %s</title></head>
<body>
<h1>Edit History for: %s</h1>
<p><a href="/entries/%s">Back to entry</a> | <a href="/entries">All entries</a></p>
<hr>`,
		html.EscapeString(entry.Title),
		html.EscapeString(entry.Title),
		html.EscapeString(entry.ID),
	))

	for i, edit := range edits {
		sb.WriteString(fmt.Sprintf(`<div style="border:1px solid #ccc; margin:10px; padding:10px;">
<h3>Edit #%d</h3>
<p><strong>Contributor:</strong> %s</p>
<p><strong>Date:</strong> %s</p>
<p><strong>Summary:</strong> %s</p>
<div><strong>Changes:</strong><br>`,
			i+1,
			html.EscapeString(edit.ModifiedBy),
			edit.ModifiedAt.Format(time.RFC3339),
			html.EscapeString(edit.Summary),
		))

		if i == 0 {
			// First edit, show full content as added
			lines := strings.Split(edit.Content, "\n")
			for _, line := range lines {
				sb.WriteString(fmt.Sprintf(`<span style='color:green'>+ %s</span><br>`, html.EscapeString(line)))
			}
		} else {
			diff := computeDiff(edits[i-1].Content, edit.Content)
			sb.WriteString(diff)
		}

		sb.WriteString(`</div></div>`)
	}

	sb.WriteString(`</body></html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(sb.String())
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