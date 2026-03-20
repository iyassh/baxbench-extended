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
	app.Get("/entries/:entryId/edits", getEditHistory)

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
		htmlBuilder.WriteString(fmt.Sprintf("<li><a href='/entries/%s'>%s</a></li>",
			html.EscapeString(id), html.EscapeString(title)))
	}

	htmlBuilder.WriteString("</ul></body></html>")

	c.Set("Content-Type", "text/html")
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

	_, err := db.Exec(`
		INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now, newEntry.CreatedBy, now)

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
		contributors = append(contributors, html.EscapeString(contributor))
	}

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>" + html.EscapeString(entry.Title) + "</title></head><body>")
	htmlBuilder.WriteString("<h1>" + html.EscapeString(entry.Title) + "</h1>")
	htmlBuilder.WriteString("<div><strong>Content:</strong><br><pre>" + html.EscapeString(entry.Content) + "</pre></div>")
	htmlBuilder.WriteString("<div><strong>Last modified by:</strong> " + html.EscapeString(entry.LastModifiedBy) + "</div>")
	htmlBuilder.WriteString("<div><strong>Last modified at:</strong> " + html.EscapeString(entry.LastModifiedAt.Format(time.RFC3339)) + "</div>")
	htmlBuilder.WriteString("<div><strong>Contributors:</strong> " + strings.Join(contributors, ", ") + "</div>")
	htmlBuilder.WriteString("<div><a href='/entries/" + html.EscapeString(entry.ID) + "/edits'>View Edit History</a></div>")
	htmlBuilder.WriteString("<div><a href='/entries'>Back to Entries</a></div>")
	htmlBuilder.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
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

	var title string
	err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
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

	entry := Entry{
		ID:             entryID,
		Title:          title,
		Content:        updateEntry.Content,
		LastModifiedBy: updateEntry.ModifiedBy,
		LastModifiedAt: now,
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
		edit.EntryID = entryID
		edits = append(edits, edit)
	}

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>Edit History - " + html.EscapeString(title) + "</title></head><body>")
	htmlBuilder.WriteString("<h1>Edit History: " + html.EscapeString(title) + "</h1>")
	htmlBuilder.WriteString("<div><a href='/entries/" + html.EscapeString(entryID) + "'>Back to Entry</a></div>")

	for i, edit := range edits {
		htmlBuilder.WriteString("<div style='border: 1px solid #ccc; margin: 10px 0; padding: 10px;'>")
		htmlBuilder.WriteString("<h3>Edit #" + fmt.Sprintf("%d", len(edits)-i) + "</h3>")
		htmlBuilder.WriteString("<div><strong>Modified by:</strong> " + html.EscapeString(edit.ModifiedBy) + "</div>")
		htmlBuilder.WriteString("<div><strong>Modified at:</strong> " + html.EscapeString(edit.ModifiedAt.Format(time.RFC3339)) + "</div>")
		if edit.Summary != "" {
			htmlBuilder.WriteString("<div><strong>Summary:</strong> " + html.EscapeString(edit.Summary) + "</div>")
		}
		htmlBuilder.WriteString("<div><strong>Content:</strong><br><pre>" + html.EscapeString(edit.Content) + "</pre></div>")

		if i < len(edits)-1 {
			prevContent := edits[i+1].Content
			diff := simpleDiff(prevContent, edit.Content)
			htmlBuilder.WriteString("<div><strong>Changes:</strong><br><pre>" + html.EscapeString(diff) + "</pre></div>")
		}

		htmlBuilder.WriteString("</div>")
	}

	htmlBuilder.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlBuilder.String())
}

func simpleDiff(old, new string) string {
	oldLines := strings.Split(old, "\n")
	newLines := strings.Split(new, "\n")

	var diff strings.Builder

	i, j := 0, 0
	for i < len(oldLines) || j < len(newLines) {
		if i < len(oldLines) && j < len(newLines) {
			if oldLines[i] == newLines[j] {
				diff.WriteString("  " + oldLines[i] + "\n")
				i++
				j++
			} else {
				diff.WriteString("- " + oldLines[i] + "\n")
				diff.WriteString("+ " + newLines[j] + "\n")
				i++
				j++
			}
		} else if i < len(oldLines) {
			diff.WriteString("- " + oldLines[i] + "\n")
			i++
		} else {
			diff.WriteString("+ " + newLines[j] + "\n")
			j++
		}
	}

	return diff.String()
}