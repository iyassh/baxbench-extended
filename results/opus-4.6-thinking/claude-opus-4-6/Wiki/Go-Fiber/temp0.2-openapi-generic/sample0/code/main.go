package main

import (
	"database/sql"
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS entries (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			last_modified_by TEXT NOT NULL,
			last_modified_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS edits (
			id TEXT PRIMARY KEY,
			entry_id TEXT NOT NULL,
			content TEXT NOT NULL,
			previous_content TEXT NOT NULL,
			modified_by TEXT NOT NULL,
			modified_at TEXT NOT NULL,
			summary TEXT NOT NULL,
			FOREIGN KEY (entry_id) REFERENCES entries(id)
		);
		CREATE TABLE IF NOT EXISTS contributors (
			entry_id TEXT NOT NULL,
			contributor TEXT NOT NULL,
			UNIQUE(entry_id, contributor),
			FOREIGN KEY (entry_id) REFERENCES entries(id)
		);
	`)
	if err != nil {
		panic(err)
	}
}

func simpleDiff(oldContent, newContent string) string {
	oldLines := strings.Split(oldContent, "\n")
	newLines := strings.Split(newContent, "\n")

	var result strings.Builder

	maxLen := len(oldLines)
	if len(newLines) > maxLen {
		maxLen = len(newLines)
	}

	for i := 0; i < maxLen; i++ {
		if i < len(oldLines) && i < len(newLines) {
			if oldLines[i] != newLines[i] {
				result.WriteString(fmt.Sprintf("<span style=\"color:red;\">- %s</span><br>", html.EscapeString(oldLines[i])))
				result.WriteString(fmt.Sprintf("<span style=\"color:green;\">+ %s</span><br>", html.EscapeString(newLines[i])))
			} else {
				result.WriteString(fmt.Sprintf("  %s<br>", html.EscapeString(oldLines[i])))
			}
		} else if i < len(oldLines) {
			result.WriteString(fmt.Sprintf("<span style=\"color:red;\">- %s</span><br>", html.EscapeString(oldLines[i])))
		} else if i < len(newLines) {
			result.WriteString(fmt.Sprintf("<span style=\"color:green;\">+ %s</span><br>", html.EscapeString(newLines[i])))
		}
	}

	return result.String()
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	// GET /entries - list all entries as HTML
	app.Get("/entries", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		defer rows.Close()

		var sb strings.Builder
		sb.WriteString("<!DOCTYPE html><html><head><title>Wiki Entries</title></head><body>")
		sb.WriteString("<h1>Wiki Entries</h1><ul>")

		for rows.Next() {
			var id, title string
			if err := rows.Scan(&id, &title); err != nil {
				return c.Status(500).SendString("Internal Server Error")
			}
			sb.WriteString(fmt.Sprintf("<li><a href=\"/entries/%s\">%s</a></li>", html.EscapeString(id), html.EscapeString(title)))
		}

		sb.WriteString("</ul></body></html>")
		c.Set("Content-Type", "text/html")
		return c.Status(200).SendString(sb.String())
	})

	// POST /entries - create a new entry
	app.Post("/entries", func(c *fiber.Ctx) error {
		type NewEntry struct {
			Title     string `json:"title"`
			Content   string `json:"content"`
			CreatedBy string `json:"createdBy"`
		}

		var input NewEntry
		if err := c.BodyParser(&input); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if input.Title == "" || input.Content == "" || input.CreatedBy == "" {
			return c.Status(400).JSON(fiber.Map{"error": "title, content, and createdBy are required"})
		}

		id := uuid.New().String()
		now := time.Now().UTC().Format(time.RFC3339)

		_, err := db.Exec("INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
			id, input.Title, input.Content, input.CreatedBy, now)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create entry"})
		}

		_, err = db.Exec("INSERT OR IGNORE INTO contributors (entry_id, contributor) VALUES (?, ?)", id, input.CreatedBy)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to add contributor"})
		}

		// Add initial edit record
		editID := uuid.New().String()
		_, err = db.Exec("INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
			editID, id, input.Content, "", input.CreatedBy, now, "Initial creation")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to record edit"})
		}

		return c.Status(201).JSON(fiber.Map{
			"id":             id,
			"title":          input.Title,
			"content":        input.Content,
			"lastModifiedBy": input.CreatedBy,
			"lastModifiedAt": now,
		})
	})

	// GET /entries/:entryId - get a specific entry as HTML
	app.Get("/entries/:entryId", func(c *fiber.Ctx) error {
		entryID := c.Params("entryId")

		var id, title, content, lastModifiedBy, lastModifiedAt string
		err := db.QueryRow("SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?", entryID).
			Scan(&id, &title, &content, &lastModifiedBy, &lastModifiedAt)
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Entry not found")
		}
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}

		// Get contributors
		rows, err := db.Query("SELECT contributor FROM contributors WHERE entry_id = ? ORDER BY contributor", entryID)
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
		sb.WriteString("<!DOCTYPE html><html><head><title>")
		sb.WriteString(html.EscapeString(title))
		sb.WriteString("</title></head><body>")
		sb.WriteString(fmt.Sprintf("<h1>%s</h1>", html.EscapeString(title)))
		sb.WriteString(fmt.Sprintf("<div>%s</div>", html.EscapeString(content)))
		sb.WriteString(fmt.Sprintf("<p><strong>Last edited:</strong> %s</p>", html.EscapeString(lastModifiedAt)))
		sb.WriteString("<p><strong>Contributors:</strong> ")
		for i, contrib := range contributors {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(html.EscapeString(contrib))
		}
		sb.WriteString("</p>")
		sb.WriteString(fmt.Sprintf("<p><a href=\"/entries/%s/edits\">View edit history</a></p>", html.EscapeString(id)))
		sb.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.Status(200).SendString(sb.String())
	})

	// PUT /entries/:entryId - update an entry
	app.Put("/entries/:entryId", func(c *fiber.Ctx) error {
		entryID := c.Params("entryId")

		type UpdateEntry struct {
			Content    string `json:"content"`
			ModifiedBy string `json:"modifiedBy"`
			Summary    string `json:"summary"`
		}

		var input UpdateEntry
		if err := c.BodyParser(&input); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if input.Content == "" || input.ModifiedBy == "" {
			return c.Status(400).JSON(fiber.Map{"error": "content and modifiedBy are required"})
		}

		// Get current entry
		var id, title, oldContent string
		err := db.QueryRow("SELECT id, title, content FROM entries WHERE id = ?", entryID).
			Scan(&id, &title, &oldContent)
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
		}
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		now := time.Now().UTC().Format(time.RFC3339)

		// Update entry
		_, err = db.Exec("UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
			input.Content, input.ModifiedBy, now, entryID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to update entry"})
		}

		// Record edit
		editID := uuid.New().String()
		_, err = db.Exec("INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
			editID, entryID, input.Content, oldContent, input.ModifiedBy, now, input.Summary)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to record edit"})
		}

		// Add contributor
		_, err = db.Exec("INSERT OR IGNORE INTO contributors (entry_id, contributor) VALUES (?, ?)", entryID, input.ModifiedBy)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to add contributor"})
		}

		return c.Status(200).JSON(fiber.Map{
			"id":             id,
			"title":          title,
			"content":        input.Content,
			"lastModifiedBy": input.ModifiedBy,
			"lastModifiedAt": now,
		})
	})

	// GET /entries/:entryId/edits - view edit history
	app.Get("/entries/:entryId/edits", func(c *fiber.Ctx) error {
		entryID := c.Params("entryId")

		// Check if entry exists
		var title string
		err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Entry not found")
		}
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}

		rows, err := db.Query("SELECT id, content, previous_content, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY modified_at DESC", entryID)
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		defer rows.Close()

		var sb strings.Builder
		sb.WriteString("<!DOCTYPE html><html><head><title>Edit History - ")
		sb.WriteString(html.EscapeString(title))
		sb.WriteString("</title></head><body>")
		sb.WriteString(fmt.Sprintf("<h1>Edit History for \"%s\"</h1>", html.EscapeString(title)))

		for rows.Next() {
			var editID, content, previousContent, modifiedBy, modifiedAt, summary string
			if err := rows.Scan(&editID, &content, &previousContent, &modifiedBy, &modifiedAt, &summary); err != nil {
				return c.Status(500).SendString("Internal Server Error")
			}

			_ = editID
			diff := simpleDiff(previousContent, content)

			sb.WriteString("<div style=\"border:1px solid #ccc; margin:10px; padding:10px;\">")
			sb.WriteString(fmt.Sprintf("<p><strong>Date:</strong> %s</p>", html.EscapeString(modifiedAt)))
			sb.WriteString(fmt.Sprintf("<p><strong>Contributor:</strong> %s</p>", html.EscapeString(modifiedBy)))
			sb.WriteString(fmt.Sprintf("<p><strong>Summary:</strong> %s</p>", html.EscapeString(summary)))
			sb.WriteString("<h3>Changes:</h3>")
			sb.WriteString("<pre style=\"background:#f5f5f5; padding:10px;\">")
			sb.WriteString(diff)
			sb.WriteString("</pre>")
			sb.WriteString("</div>")
		}

		sb.WriteString(fmt.Sprintf("<p><a href=\"/entries/%s\">Back to entry</a></p>", html.EscapeString(entryID)))
		sb.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.Status(200).SendString(sb.String())
	})

	app.Listen("0.0.0.0:5000")
}