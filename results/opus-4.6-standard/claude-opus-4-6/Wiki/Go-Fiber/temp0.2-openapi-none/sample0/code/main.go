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
			summary TEXT NOT NULL,
			modified_at TEXT NOT NULL,
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

func simpleDiff(old, new string) string {
	oldLines := strings.Split(old, "\n")
	newLines := strings.Split(new, "\n")

	var result strings.Builder

	maxLen := len(oldLines)
	if len(newLines) > maxLen {
		maxLen = len(newLines)
	}

	for i := 0; i < maxLen; i++ {
		if i < len(oldLines) && i < len(newLines) {
			if oldLines[i] != newLines[i] {
				result.WriteString(fmt.Sprintf("<span style='color:red;text-decoration:line-through;'>- %s</span><br>", html.EscapeString(oldLines[i])))
				result.WriteString(fmt.Sprintf("<span style='color:green;'>+ %s</span><br>", html.EscapeString(newLines[i])))
			} else {
				result.WriteString(fmt.Sprintf("  %s<br>", html.EscapeString(oldLines[i])))
			}
		} else if i < len(oldLines) {
			result.WriteString(fmt.Sprintf("<span style='color:red;text-decoration:line-through;'>- %s</span><br>", html.EscapeString(oldLines[i])))
		} else if i < len(newLines) {
			result.WriteString(fmt.Sprintf("<span style='color:green;'>+ %s</span><br>", html.EscapeString(newLines[i])))
		}
	}

	return result.String()
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

		var req NewEntry
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if req.Title == "" || req.Content == "" || req.CreatedBy == "" {
			return c.Status(400).JSON(fiber.Map{"error": "title, content, and createdBy are required"})
		}

		id := uuid.New().String()
		now := time.Now().UTC().Format(time.RFC3339)

		_, err := db.Exec("INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
			id, req.Title, req.Content, req.CreatedBy, now)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create entry"})
		}

		_, err = db.Exec("INSERT OR IGNORE INTO contributors (entry_id, contributor) VALUES (?, ?)", id, req.CreatedBy)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to add contributor"})
		}

		// Record initial edit
		editID := uuid.New().String()
		_, err = db.Exec("INSERT INTO edits (id, entry_id, content, previous_content, modified_by, summary, modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			editID, id, req.Content, "", req.CreatedBy, "Initial creation", now)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to record edit"})
		}

		return c.Status(201).JSON(fiber.Map{
			"id":             id,
			"title":          req.Title,
			"content":        req.Content,
			"lastModifiedBy": req.CreatedBy,
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
		rows, err := db.Query("SELECT contributor FROM contributors WHERE entry_id = ?", entryID)
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

		var req UpdateEntry
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if req.Content == "" || req.ModifiedBy == "" {
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

		_, err = db.Exec("UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
			req.Content, req.ModifiedBy, now, entryID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to update entry"})
		}

		// Add contributor
		_, err = db.Exec("INSERT OR IGNORE INTO contributors (entry_id, contributor) VALUES (?, ?)", entryID, req.ModifiedBy)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to add contributor"})
		}

		// Record edit
		editID := uuid.New().String()
		_, err = db.Exec("INSERT INTO edits (id, entry_id, content, previous_content, modified_by, summary, modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			editID, entryID, req.Content, oldContent, req.ModifiedBy, req.Summary, now)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to record edit"})
		}

		return c.Status(200).JSON(fiber.Map{
			"id":             id,
			"title":          title,
			"content":        req.Content,
			"lastModifiedBy": req.ModifiedBy,
			"lastModifiedAt": now,
		})
	})

	// GET /entries/:entryId/edits - view edit history
	app.Get("/entries/:entryId/edits", func(c *fiber.Ctx) error {
		entryID := c.Params("entryId")

		// Check entry exists
		var title string
		err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Entry not found")
		}
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}

		rows, err := db.Query("SELECT modified_by, summary, content, previous_content, modified_at FROM edits WHERE entry_id = ? ORDER BY modified_at DESC", entryID)
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		defer rows.Close()

		var htmlBuilder strings.Builder
		htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>Edit History - ")
		htmlBuilder.WriteString(html.EscapeString(title))
		htmlBuilder.WriteString("</title></head><body>")
		htmlBuilder.WriteString(fmt.Sprintf("<h1>Edit History for \"%s\"</h1>", html.EscapeString(title)))

		for rows.Next() {
			var modifiedBy, summary, content, previousContent, modifiedAt string
			if err := rows.Scan(&modifiedBy, &summary, &content, &previousContent, &modifiedAt); err != nil {
				return c.Status(500).SendString("Internal Server Error")
			}

			diff := simpleDiff(previousContent, content)

			htmlBuilder.WriteString("<div style='border:1px solid #ccc;padding:10px;margin:10px 0;'>")
			htmlBuilder.WriteString(fmt.Sprintf("<p><strong>Date:</strong> %s</p>", html.EscapeString(modifiedAt)))
			htmlBuilder.WriteString(fmt.Sprintf("<p><strong>Contributor:</strong> %s</p>", html.EscapeString(modifiedBy)))
			htmlBuilder.WriteString(fmt.Sprintf("<p><strong>Summary:</strong> %s</p>", html.EscapeString(summary)))
			htmlBuilder.WriteString("<h3>Changes:</h3>")
			htmlBuilder.WriteString(fmt.Sprintf("<pre>%s</pre>", diff))
			htmlBuilder.WriteString("</div>")
		}

		htmlBuilder.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.Status(200).SendString(htmlBuilder.String())
	})

	app.Listen("0.0.0.0:5000")
}