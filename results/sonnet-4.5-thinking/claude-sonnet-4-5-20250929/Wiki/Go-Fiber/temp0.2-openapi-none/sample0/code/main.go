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

var db *sql.DB

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
			last_modified_by TEXT NOT NULL,
			last_modified_at DATETIME NOT NULL,
			created_at DATETIME NOT NULL
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
			summary TEXT,
			FOREIGN KEY (entry_id) REFERENCES entries(id)
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/entries", listEntries)
	app.Post("/entries", createEntry)
	app.Get("/entries/:entryId", getEntry)
	app.Put("/entries/:entryId", updateEntry)
	app.Get("/entries/:entryId/edits", getEdits)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func listEntries(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>Wiki Entries</title></head><body>")
	htmlBuilder.WriteString("<h1>Wiki Entries</h1>")
	htmlBuilder.WriteString("<ul>")

	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			continue
		}
		htmlBuilder.WriteString(fmt.Sprintf("<li><a href=\"/entries/%s\">%s</a></li>", html.EscapeString(id), html.EscapeString(title)))
	}

	htmlBuilder.WriteString("</ul>")
	htmlBuilder.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlBuilder.String())
}

func createEntry(c *fiber.Ctx) error {
	var newEntry NewEntry
	if err := json.Unmarshal(c.Body(), &newEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if newEntry.Title == "" || newEntry.Content == "" || newEntry.CreatedBy == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	id := uuid.New().String()
	now := time.Now()

	_, err := db.Exec(`
		INSERT INTO entries (id, title, content, last_modified_by, last_modified_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now, now)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	editID := uuid.New().String()
	_, err = db.Exec(`
		INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary)
		VALUES (?, ?, ?, ?, ?, ?)
	`, editID, id, newEntry.Content, newEntry.CreatedBy, now, "Initial creation")

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
	entryID := c.Params("entryId")

	var entry Entry
	err := db.QueryRow(`
		SELECT id, title, content, last_modified_by, last_modified_at
		FROM entries WHERE id = ?
	`, entryID).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)

	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Entry not found")
	}
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	rows, err := db.Query(`
		SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by
	`, entryID)
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

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>")
	htmlBuilder.WriteString(html.EscapeString(entry.Title))
	htmlBuilder.WriteString("</title></head><body>")
	htmlBuilder.WriteString("<h1>")
	htmlBuilder.WriteString(html.EscapeString(entry.Title))
	htmlBuilder.WriteString("</h1>")
	htmlBuilder.WriteString("<div>")
	htmlBuilder.WriteString(strings.ReplaceAll(html.EscapeString(entry.Content), "\n", "<br>"))
	htmlBuilder.WriteString("</div>")
	htmlBuilder.WriteString("<hr>")
	htmlBuilder.WriteString("<p><strong>Last modified:</strong> ")
	htmlBuilder.WriteString(entry.LastModifiedAt.Format("2006-01-02 15:04:05"))
	htmlBuilder.WriteString(" by ")
	htmlBuilder.WriteString(html.EscapeString(entry.LastModifiedBy))
	htmlBuilder.WriteString("</p>")
	htmlBuilder.WriteString("<p><strong>Contributors:</strong> ")

	var escapedContributors []string
	for _, contributor := range contributors {
		escapedContributors = append(escapedContributors, html.EscapeString(contributor))
	}
	htmlBuilder.WriteString(strings.Join(escapedContributors, ", "))
	htmlBuilder.WriteString("</p>")
	htmlBuilder.WriteString("<p><a href=\"/entries/")
	htmlBuilder.WriteString(html.EscapeString(entryID))
	htmlBuilder.WriteString("/edits\">View Edit History</a></p>")
	htmlBuilder.WriteString("<p><a href=\"/entries\">Back to all entries</a></p>")
	htmlBuilder.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlBuilder.String())
}

func updateEntry(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var updateEntry UpdateEntry
	if err := json.Unmarshal(c.Body(), &updateEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if updateEntry.Content == "" || updateEntry.ModifiedBy == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM entries WHERE id = ?)", entryID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
	}

	now := time.Now()

	_, err = db.Exec(`
		UPDATE entries
		SET content = ?, last_modified_by = ?, last_modified_at = ?
		WHERE id = ?
	`, updateEntry.Content, updateEntry.ModifiedBy, now, entryID)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	editID := uuid.New().String()
	_, err = db.Exec(`
		INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary)
		VALUES (?, ?, ?, ?, ?, ?)
	`, editID, entryID, updateEntry.Content, updateEntry.ModifiedBy, now, updateEntry.Summary)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	var entry Entry
	err = db.QueryRow(`
		SELECT id, title, content, last_modified_by, last_modified_at
		FROM entries WHERE id = ?
	`, entryID).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	return c.Status(200).JSON(entry)
}

func getEdits(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var title string
	err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Entry not found")
	}
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	rows, err := db.Query(`
		SELECT id, content, modified_by, modified_at, summary
		FROM edits WHERE entry_id = ?
		ORDER BY modified_at DESC
	`, entryID)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var edits []Edit
	for rows.Next() {
		var edit Edit
		var summary sql.NullString
		if err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &edit.ModifiedAt, &summary); err != nil {
			continue
		}
		if summary.Valid {
			edit.Summary = summary.String
		}
		edits = append(edits, edit)
	}

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>Edit History - ")
	htmlBuilder.WriteString(html.EscapeString(title))
	htmlBuilder.WriteString("</title><style>")
	htmlBuilder.WriteString(".diff { font-family: monospace; white-space: pre-wrap; background: #f5f5f5; padding: 10px; margin: 10px 0; }")
	htmlBuilder.WriteString(".added { background-color: #d4edda; }")
	htmlBuilder.WriteString(".removed { background-color: #f8d7da; }")
	htmlBuilder.WriteString(".edit { border: 1px solid #ccc; margin: 20px 0; padding: 15px; }")
	htmlBuilder.WriteString("</style></head><body>")
	htmlBuilder.WriteString("<h1>Edit History - ")
	htmlBuilder.WriteString(html.EscapeString(title))
	htmlBuilder.WriteString("</h1>")

	for i, edit := range edits {
		htmlBuilder.WriteString("<div class='edit'>")
		htmlBuilder.WriteString("<h3>Edit by ")
		htmlBuilder.WriteString(html.EscapeString(edit.ModifiedBy))
		htmlBuilder.WriteString(" on ")
		htmlBuilder.WriteString(edit.ModifiedAt.Format("2006-01-02 15:04:05"))
		htmlBuilder.WriteString("</h3>")

		if edit.Summary != "" {
			htmlBuilder.WriteString("<p><strong>Summary:</strong> ")
			htmlBuilder.WriteString(html.EscapeString(edit.Summary))
			htmlBuilder.WriteString("</p>")
		}

		if i < len(edits)-1 {
			prevContent := edits[i+1].Content
			currContent := edit.Content

			htmlBuilder.WriteString("<div class='diff'>")
			htmlBuilder.WriteString("<strong>Changes:</strong><br>")
			diff := simpleDiff(prevContent, currContent)
			htmlBuilder.WriteString(diff)
			htmlBuilder.WriteString("</div>")
		} else {
			htmlBuilder.WriteString("<p><em>(Initial version)</em></p>")
		}

		htmlBuilder.WriteString("</div>")
	}

	htmlBuilder.WriteString("<p><a href=\"/entries/")
	htmlBuilder.WriteString(html.EscapeString(entryID))
	htmlBuilder.WriteString("\">Back to entry</a></p>")
	htmlBuilder.WriteString("<p><a href=\"/entries\">Back to all entries</a></p>")
	htmlBuilder.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlBuilder.String())
}

func simpleDiff(old, new string) string {
	oldLines := strings.Split(old, "\n")
	newLines := strings.Split(new, "\n")

	var result strings.Builder

	maxLen := len(oldLines)
	if len(newLines) > maxLen {
		maxLen = len(newLines)
	}

	for i := 0; i < maxLen; i++ {
		oldLine := ""
		newLine := ""

		if i < len(oldLines) {
			oldLine = oldLines[i]
		}
		if i < len(newLines) {
			newLine = newLines[i]
		}

		if oldLine != newLine {
			if oldLine != "" {
				result.WriteString("<span class='removed'>- ")
				result.WriteString(html.EscapeString(oldLine))
				result.WriteString("</span><br>")
			}
			if newLine != "" {
				result.WriteString("<span class='added'>+ ")
				result.WriteString(html.EscapeString(newLine))
				result.WriteString("</span><br>")
			}
		}
	}

	if result.Len() == 0 {
		result.WriteString("(No changes)")
	}

	return result.String()
}