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

	_, err = db.Exec(createEntries)
	if err != nil {
		log.Fatal(err)
	}
	_, err = db.Exec(createEdits)
	if err != nil {
		log.Fatal(err)
	}
}

type Entry struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	Content        string `json:"content"`
	LastModifiedBy string `json:"lastModifiedBy"`
	LastModifiedAt string `json:"lastModifiedAt"`
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
			sb.WriteString(fmt.Sprintf("<span style='color:red;'>- %s</span><br>", html.EscapeString(l)))
		} else {
			sb.WriteString(fmt.Sprintf("<span>  %s</span><br>", html.EscapeString(l)))
		}
	}
	for _, l := range newLines {
		if !oldSet[l] {
			sb.WriteString(fmt.Sprintf("<span style='color:green;'>+ %s</span><br>", html.EscapeString(l)))
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
	sb.WriteString(`<!DOCTYPE html><html><head><title>Wiki Entries</title></head><body>`)
	sb.WriteString(`<h1>Wiki Entries</h1><ul>`)

	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		sb.WriteString(fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, html.EscapeString(id), html.EscapeString(title)))
	}

	sb.WriteString(`</ul></body></html>`)
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
		id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now.Format(time.RFC3339),
	)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	// Also record the initial edit
	editID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
		editID, id, newEntry.Content, newEntry.CreatedBy, now.Format(time.RFC3339), "Initial creation",
	)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	entry := Entry{
		ID:             id,
		Title:          newEntry.Title,
		Content:        newEntry.Content,
		LastModifiedBy: newEntry.CreatedBy,
		LastModifiedAt: now.Format(time.RFC3339),
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
	sb.WriteString(`<!DOCTYPE html><html><head><title>`)
	sb.WriteString(html.EscapeString(entry.Title))
	sb.WriteString(`</title></head><body>`)
	sb.WriteString(fmt.Sprintf(`<h1>%s</h1>`, html.EscapeString(entry.Title)))
	sb.WriteString(fmt.Sprintf(`<p><strong>Last edited:</strong> %s</p>`, html.EscapeString(entry.LastModifiedAt)))
	sb.WriteString(fmt.Sprintf(`<p><strong>Last modified by:</strong> %s</p>`, html.EscapeString(entry.LastModifiedBy)))
	sb.WriteString(fmt.Sprintf(`<p><strong>Contributors:</strong> %s</p>`, html.EscapeString(strings.Join(contributors, ", "))))
	sb.WriteString(`<hr><div>`)
	sb.WriteString(strings.ReplaceAll(html.EscapeString(entry.Content), "\n", "<br>"))
	sb.WriteString(`</div><hr>`)
	sb.WriteString(fmt.Sprintf(`<a href="/entries/%s/edits">View edit history</a>`, html.EscapeString(entry.ID)))
	sb.WriteString(` | <a href="/entries">Back to list</a>`)
	sb.WriteString(`</body></html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(sb.String())
}

func updateEntry(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var updateEntry UpdateEntry
	if err := c.BodyParser(&updateEntry); err != nil {
		return c.Status(400).SendString("Bad Request")
	}

	if strings.TrimSpace(updateEntry.Content) == "" || strings.TrimSpace(updateEntry.ModifiedBy) == "" {
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
	summary := updateEntry.Summary
	if strings.TrimSpace(summary) == "" {
		summary = "No summary provided"
	}

	_, err = db.Exec(
		"UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
		updateEntry.Content, updateEntry.ModifiedBy, now.Format(time.RFC3339), entryID,
	)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	editID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
		editID, entryID, updateEntry.Content, updateEntry.ModifiedBy, now.Format(time.RFC3339), summary,
	)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	updatedEntry := Entry{
		ID:             entry.ID,
		Title:          entry.Title,
		Content:        updateEntry.Content,
		LastModifiedBy: updateEntry.ModifiedBy,
		LastModifiedAt: now.Format(time.RFC3339),
	}

	return c.Status(200).JSON(updatedEntry)
}

func getEdits(c *fiber.Ctx) error {
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
		"SELECT id, entry_id, content, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY modified_at DESC",
		entryID,
	)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	var edits []Edit
	for rows.Next() {
		var edit Edit
		var modifiedAtStr string
		if err := rows.Scan(&edit.ID, &edit.EntryID, &edit.Content, &edit.ModifiedBy, &modifiedAtStr, &edit.Summary); err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		t, err := time.Parse(time.RFC3339, modifiedAtStr)
		if err != nil {
			t = time.Now()
		}
		edit.ModifiedAt = t
		edits = append(edits, edit)
	}

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html><html><head><title>Edit History - `)
	sb.WriteString(html.EscapeString(entry.Title))
	sb.WriteString(`</title></head><body>`)
	sb.WriteString(fmt.Sprintf(`<h1>Edit History for: %s</h1>`, html.EscapeString(entry.Title)))
	sb.WriteString(fmt.Sprintf(`<a href="/entries/%s">Back to entry</a> | <a href="/entries">Back to list</a>`, html.EscapeString(entry.ID)))
	sb.WriteString(`<hr>`)

	for i, edit := range edits {
		sb.WriteString(`<div style="border:1px solid #ccc; margin:10px; padding:10px;">`)
		sb.WriteString(fmt.Sprintf(`<p><strong>Edit #%d</strong></p>`, len(edits)-i))
		sb.WriteString(fmt.Sprintf(`<p><strong>Contributor:</strong> %s</p>`, html.EscapeString(edit.ModifiedBy)))
		sb.WriteString(fmt.Sprintf(`<p><strong>Date:</strong> %s</p>`, html.EscapeString(edit.ModifiedAt.Format(time.RFC3339))))
		sb.WriteString(fmt.Sprintf(`<p><strong>Summary:</strong> %s</p>`, html.EscapeString(edit.Summary)))

		// Compute diff with previous edit
		if i < len(edits)-1 {
			prevContent := edits[i+1].Content
			diff := computeDiff(prevContent, edit.Content)
			sb.WriteString(`<p><strong>Changes:</strong></p>`)
			sb.WriteString(`<div style="font-family:monospace; background:#f5f5f5; padding:5px;">`)
			sb.WriteString(diff)
			sb.WriteString(`</div>`)
		} else {
			sb.WriteString(`<p><strong>Content (initial):</strong></p>`)
			sb.WriteString(`<div style="font-family:monospace; background:#f5f5f5; padding:5px;">`)
			sb.WriteString(strings.ReplaceAll(html.EscapeString(edit.Content), "\n", "<br>"))
			sb.WriteString(`</div>`)
		}

		sb.WriteString(`</div>`)
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
	app.Get("/entries/:entryId/edits", getEdits)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}