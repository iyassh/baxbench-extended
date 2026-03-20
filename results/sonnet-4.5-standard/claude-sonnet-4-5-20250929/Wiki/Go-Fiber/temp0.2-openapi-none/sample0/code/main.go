<CODE>
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
	ID         int
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
			last_modified_by TEXT NOT NULL,
			last_modified_at DATETIME NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS edits (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			entry_id TEXT NOT NULL,
			content TEXT NOT NULL,
			modified_by TEXT NOT NULL,
			modified_at DATETIME NOT NULL,
			summary TEXT,
			FOREIGN KEY (entry_id) REFERENCES entries(id)
		)
	`)
	return err
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/entries", getEntries)
	app.Post("/entries", createEntry)
	app.Get("/entries/:entryId", getEntry)
	app.Put("/entries/:entryId", updateEntry)
	app.Get("/entries/:entryId/edits", getEdits)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getEntries(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var html strings.Builder
	html.WriteString("<!DOCTYPE html><html><head><title>Wiki Entries</title></head><body>")
	html.WriteString("<h1>Wiki Entries</h1>")
	html.WriteString("<ul>")

	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			continue
		}
		html.WriteString(fmt.Sprintf("<li><a href=\"/entries/%s\">%s</a></li>", id, title))
	}

	html.WriteString("</ul></body></html>")
	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func createEntry(c *fiber.Ctx) error {
	var newEntry NewEntry
	if err := json.Unmarshal(c.Body(), &newEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	id := uuid.New().String()
	now := time.Now()

	_, err := db.Exec(
		"INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
		id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	_, err = db.Exec(
		"INSERT INTO edits (entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?)",
		id, newEntry.Content, newEntry.CreatedBy, now, "Initial creation",
	)
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
		if err := rows.Scan(&contributor); err == nil {
			contributors = append(contributors, contributor)
		}
	}

	var html strings.Builder
	html.WriteString("<!DOCTYPE html><html><head><title>" + entry.Title + "</title></head><body>")
	html.WriteString("<h1>" + entry.Title + "</h1>")
	html.WriteString("<p>" + strings.ReplaceAll(entry.Content, "\n", "<br>") + "</p>")
	html.WriteString("<p><strong>Last modified:</strong> " + entry.LastModifiedAt.Format(time.RFC3339) + " by " + entry.LastModifiedBy + "</p>")
	html.WriteString("<p><strong>Contributors:</strong> " + strings.Join(contributors, ", ") + "</p>")
	html.WriteString("<p><a href=\"/entries/" + entryID + "/edits\">View edit history</a></p>")
	html.WriteString("<p><a href=\"/entries\">Back to all entries</a></p>")
	html.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func updateEntry(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var updateEntry UpdateEntry
	if err := json.Unmarshal(c.Body(), &updateEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
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
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	_, err = db.Exec(
		"INSERT INTO edits (entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?)",
		entryID, updateEntry.Content, updateEntry.ModifiedBy, now, updateEntry.Summary,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	var entry Entry
	err = db.QueryRow(
		"SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?",
		entryID,
	).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	return c.JSON(entry)
}

func getEdits(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM entries WHERE id = ?)", entryID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).SendString("Entry not found")
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
		var summary sql.NullString
		if err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &edit.ModifiedAt, &summary); err == nil {
			edit.EntryID = entryID
			if summary.Valid {
				edit.Summary = summary.String
			}
			edits = append(edits, edit)
		}
	}

	var html strings.Builder
	html.WriteString("<!DOCTYPE html><html><head><title>Edit History</title></head><body>")
	html.WriteString("<h1>Edit History</h1>")

	for i, edit := range edits {
		html.WriteString("<div style=\"border: 1px solid #ccc; margin: 10px 0; padding: 10px;\">")
		html.WriteString("<h3>Edit #" + fmt.Sprintf("%d", len(edits)-i) + "</h3>")
		html.WriteString("<p><strong>Modified by:</strong> " + edit.ModifiedBy + "</p>")
		html.WriteString("<p><strong>Modified at:</strong> " + edit.ModifiedAt.Format(time.RFC3339) + "</p>")
		html.WriteString("<p><strong>Summary:</strong> " + edit.Summary + "</p>")

		if i < len(edits)-1 {
			diff := generateDiff(edits[i+1].Content, edit.Content)
			html.WriteString("<p><strong>Changes:</strong></p>")
			html.WriteString("<pre>" + diff + "</pre>")
		} else {
			html.WriteString("<p><strong>Content:</strong></p>")
			html.WriteString("<pre>" + edit.Content + "</pre>")
		}

		html.WriteString("</div>")
	}

	html.WriteString("<p><a href=\"/entries/" + entryID + "\">Back to entry</a></p>")
	html.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func generateDiff(oldContent, newContent string) string {
	oldLines := strings.Split(oldContent, "\n")
	newLines := strings.Split(newContent, "\n")

	var diff strings.Builder
	maxLen := len(oldLines)
	if len(newLines) > maxLen {
		maxLen = len(newLines)
	}

	for i := 0; i < maxLen; i++ {
		if i < len(oldLines) && i < len(newLines) {
			if oldLines[i] != newLines[i] {
				diff.WriteString("- " + oldLines[i] + "\n")
				diff.WriteString("+ " + newLines[i] + "\n")
			} else {
				diff.WriteString("  " + oldLines[i] + "\n")
			}
		} else if i < len(oldLines) {
			diff.WriteString("- " + oldLines[i] + "\n")
		} else {
			diff.WriteString("+ " + newLines[i] + "\n")
		}
	}

	return diff.String()
}
</CODE>