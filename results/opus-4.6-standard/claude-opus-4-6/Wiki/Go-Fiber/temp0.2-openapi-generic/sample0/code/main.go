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

	var diff strings.Builder

	maxLen := len(oldLines)
	if len(newLines) > maxLen {
		maxLen = len(newLines)
	}

	for i := 0; i < maxLen; i++ {
		if i >= len(oldLines) {
			diff.WriteString(fmt.Sprintf("<div style='color:green;'>+ %s</div>", html.EscapeString(newLines[i])))
		} else if i >= len(newLines) {
			diff.WriteString(fmt.Sprintf("<div style='color:red;'>- %s</div>", html.EscapeString(oldLines[i])))
		} else if oldLines[i] != newLines[i] {
			diff.WriteString(fmt.Sprintf("<div style='color:red;'>- %s</div>", html.EscapeString(oldLines[i])))
			diff.WriteString(fmt.Sprintf("<div style='color:green;'>+ %s</div>", html.EscapeString(newLines[i])))
		} else {
			diff.WriteString(fmt.Sprintf("<div>  %s</div>", html.EscapeString(oldLines[i])))
		}
	}

	return diff.String()
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	// GET /entries - list all entries
	app.Get("/entries", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		defer rows.Close()

		var htmlBuilder strings.Builder
		htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>Wiki Entries</title></head><body>")
		htmlBuilder.WriteString("<h1>Wiki Entries</h1><ul>")

		for rows.Next() {
			var id, title string
			if err := rows.Scan(&id, &title); err != nil {
				return c.Status(500).SendString("Internal Server Error")
			}
			htmlBuilder.WriteString(fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, html.EscapeString(id), html.EscapeString(title)))
		}

		htmlBuilder.WriteString("</ul></body></html>")

		c.Set("Content-Type", "text/html")
		return c.Status(200).SendString(htmlBuilder.String())
	})

	// POST /entries - create new entry
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

		tx, err := db.Begin()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		_, err = tx.Exec("INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
			id, input.Title, input.Content, input.CreatedBy, now)
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		_, err = tx.Exec("INSERT INTO contributors (entry_id, contributor) VALUES (?, ?)", id, input.CreatedBy)
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		editID := uuid.New().String()
		_, err = tx.Exec("INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
			editID, id, input.Content, "", input.CreatedBy, now, "Initial creation")
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		return c.Status(201).JSON(fiber.Map{
			"id":             id,
			"title":          input.Title,
			"content":        input.Content,
			"lastModifiedBy": input.CreatedBy,
			"lastModifiedAt": now,
		})
	})

	// GET /entries/:entryId - get specific entry
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

		var htmlBuilder strings.Builder
		htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>")
		htmlBuilder.WriteString(html.EscapeString(title))
		htmlBuilder.WriteString("</title></head><body>")
		htmlBuilder.WriteString(fmt.Sprintf("<h1>%s</h1>", html.EscapeString(title)))
		htmlBuilder.WriteString(fmt.Sprintf("<div>%s</div>", html.EscapeString(content)))
		htmlBuilder.WriteString(fmt.Sprintf("<p><strong>Last edited:</strong> %s</p>", html.EscapeString(lastModifiedAt)))
		htmlBuilder.WriteString("<p><strong>Contributors:</strong> ")
		for i, contrib := range contributors {
			if i > 0 {
				htmlBuilder.WriteString(", ")
			}
			htmlBuilder.WriteString(html.EscapeString(contrib))
		}
		htmlBuilder.WriteString("</p>")
		htmlBuilder.WriteString(fmt.Sprintf(`<p><a href="/entries/%s/edits">View edit history</a></p>`, html.EscapeString(id)))
		htmlBuilder.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.Status(200).SendString(htmlBuilder.String())
	})

	// PUT /entries/:entryId - update entry
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

		tx, err := db.Begin()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		var title, oldContent string
		err = tx.QueryRow("SELECT title, content FROM entries WHERE id = ?", entryID).Scan(&title, &oldContent)
		if err == sql.ErrNoRows {
			tx.Rollback()
			return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
		}
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		now := time.Now().UTC().Format(time.RFC3339)

		_, err = tx.Exec("UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
			input.Content, input.ModifiedBy, now, entryID)
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		editID := uuid.New().String()
		_, err = tx.Exec("INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
			editID, entryID, input.Content, oldContent, input.ModifiedBy, now, input.Summary)
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		_, err = tx.Exec("INSERT OR IGNORE INTO contributors (entry_id, contributor) VALUES (?, ?)", entryID, input.ModifiedBy)
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}

		return c.Status(200).JSON(fiber.Map{
			"id":             entryID,
			"title":          title,
			"content":        input.Content,
			"lastModifiedBy": input.ModifiedBy,
			"lastModifiedAt": now,
		})
	})

	// GET /entries/:entryId/edits - view edit history
	app.Get("/entries/:entryId/edits", func(c *fiber.Ctx) error {
		entryID := c.Params("entryId")

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

		var htmlBuilder strings.Builder
		htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>Edit History - ")
		htmlBuilder.WriteString(html.EscapeString(title))
		htmlBuilder.WriteString("</title></head><body>")
		htmlBuilder.WriteString(fmt.Sprintf("<h1>Edit History for %s</h1>", html.EscapeString(title)))

		for rows.Next() {
			var editID, content, previousContent, modifiedBy, modifiedAt, summary string
			if err := rows.Scan(&editID, &content, &previousContent, &modifiedBy, &modifiedAt, &summary); err != nil {
				return c.Status(500).SendString("Internal Server Error")
			}
			_ = editID

			htmlBuilder.WriteString("<div style='border:1px solid #ccc; margin:10px; padding:10px;'>")
			htmlBuilder.WriteString(fmt.Sprintf("<p><strong>Contributor:</strong> %s</p>", html.EscapeString(modifiedBy)))
			htmlBuilder.WriteString(fmt.Sprintf("<p><strong>Date:</strong> %s</p>", html.EscapeString(modifiedAt)))
			htmlBuilder.WriteString(fmt.Sprintf("<p><strong>Summary:</strong> %s</p>", html.EscapeString(summary)))
			htmlBuilder.WriteString("<h3>Changes:</h3>")
			htmlBuilder.WriteString(simpleDiff(previousContent, content))
			htmlBuilder.WriteString("</div>")
		}

		htmlBuilder.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.Status(200).SendString(htmlBuilder.String())
	})

	app.Listen("0.0.0.0:5000")
}