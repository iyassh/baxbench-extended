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
	ID              int       `json:"id"`
	EntryID         string    `json:"entryId"`
	Content         string    `json:"content"`
	ModifiedBy      string    `json:"modifiedBy"`
	Summary         string    `json:"summary"`
	ModifiedAt      time.Time `json:"modifiedAt"`
	PreviousContent string    `json:"previousContent"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	createTables()

	app := fiber.New()

	app.Get("/entries", getEntries)
	app.Post("/entries", createEntry)
	app.Get("/entries/:entryId", getEntry)
	app.Put("/entries/:entryId", updateEntry)
	app.Get("/entries/:entryId/edits", getEntryEdits)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createTables() {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS entries (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			current_content TEXT NOT NULL,
			last_modified_by TEXT NOT NULL,
			last_modified_at DATETIME NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS edits (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			entry_id TEXT NOT NULL,
			content TEXT NOT NULL,
			modified_by TEXT NOT NULL,
			summary TEXT NOT NULL,
			modified_at DATETIME NOT NULL,
			previous_content TEXT NOT NULL,
			FOREIGN KEY (entry_id) REFERENCES entries (id)
		)
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func getEntries(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
	if err != nil {
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>Wiki Entries</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 40px; }
		h1 { color: #333; }
		.entry-list { list-style-type: none; padding: 0; }
		.entry-list li { margin: 10px 0; }
		.entry-list a { text-decoration: none; color: #0066cc; }
		.entry-list a:hover { text-decoration: underline; }
		.create-form { margin: 20px 0; border: 1px solid #ddd; padding: 20px; }
		.create-form input, .create-form textarea { width: 100%; margin: 5px 0; padding: 5px; }
		.create-form button { background: #0066cc; color: white; padding: 10px 20px; border: none; cursor: pointer; }
	</style>
</head>
<body>
	<h1>Wiki Entries</h1>
	<ul class="entry-list">`)

	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			return c.Status(500).SendString("Internal server error")
		}
		htmlBuilder.WriteString(fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, html.EscapeString(id), html.EscapeString(title)))
	}

	htmlBuilder.WriteString(`</ul>
	<div class="create-form">
		<h2>Create New Entry</h2>
		<form id="createForm">
			<input type="text" id="title" placeholder="Title" required>
			<textarea id="content" placeholder="Content" rows="10" required></textarea>
			<input type="text" id="createdBy" placeholder="Your Name" required>
			<button type="submit">Create Entry</button>
		</form>
	</div>
	<script>
		document.getElementById('createForm').onsubmit = function(e) {
			e.preventDefault();
			const data = {
				title: document.getElementById('title').value,
				content: document.getElementById('content').value,
				createdBy: document.getElementById('createdBy').value
			};
			fetch('/entries', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify(data)
			}).then(response => {
				if (response.ok) {
					location.reload();
				} else {
					alert('Error creating entry');
				}
			});
		};
	</script>
</body>
</html>`)

	c.Type("html")
	return c.SendString(htmlBuilder.String())
}

func createEntry(c *fiber.Ctx) error {
	var newEntry NewEntry
	if err := c.BodyParser(&newEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if newEntry.Title == "" || newEntry.Content == "" || newEntry.CreatedBy == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Title, content, and createdBy are required"})
	}

	entryID := uuid.New().String()
	now := time.Now()

	_, err := db.Exec(`
		INSERT INTO entries (id, title, current_content, last_modified_by, last_modified_at)
		VALUES (?, ?, ?, ?, ?)
	`, entryID, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create entry"})
	}

	_, err = db.Exec(`
		INSERT INTO edits (entry_id, content, modified_by, summary, modified_at, previous_content)
		VALUES (?, ?, ?, ?, ?, ?)
	`, entryID, newEntry.Content, newEntry.CreatedBy, "Initial creation", now, "")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create edit record"})
	}

	entry := Entry{
		ID:             entryID,
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
		SELECT id, title, current_content, last_modified_by, last_modified_at
		FROM entries WHERE id = ?
	`, entryID).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Entry not found")
		}
		return c.Status(500).SendString("Internal server error")
	}

	rows, err := db.Query(`
		SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by
	`, entryID)
	if err != nil {
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var contributors []string
	for rows.Next() {
		var contributor string
		if err := rows.Scan(&contributor); err != nil {
			return c.Status(500).SendString("Internal server error")
		}
		contributors = append(contributors, contributor)
	}

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>` + html.EscapeString(entry.Title) + `</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 40px; }
		h1 { color: #333; }
		.meta { color: #666; margin: 10px 0; }
		.content { line-height: 1.6; margin: 20px 0; white-space: pre-wrap; }
		.edit-form { margin: 20px 0; border: 1px solid #ddd; padding: 20px; }
		.edit-form textarea { width: 100%; margin: 5px 0; padding: 5px; }
		.edit-form input { width: 100%; margin: 5px 0; padding: 5px; }
		.edit-form button { background: #0066cc; color: white; padding: 10px 20px; border: none; cursor: pointer; }
		.nav-links { margin: 20px 0; }
		.nav-links a { color: #0066cc; text-decoration: none; margin-right: 20px; }
	</style>
</head>
<body>
	<div class="nav-links">
		<a href="/entries">← Back to All Entries</a>
		<a href="/entries/` + html.EscapeString(entryID) + `/edits">View Edit History</a>
	</div>
	<h1>` + html.EscapeString(entry.Title) + `</h1>
	<div class="meta">
		Last modified by: ` + html.EscapeString(entry.LastModifiedBy) + ` on ` + entry.LastModifiedAt.Format("2006-01-02 15:04:05") + `<br>
		Contributors: ` + html.EscapeString(strings.Join(contributors, ", ")) + `
	</div>
	<div class="content">` + html.EscapeString(entry.Content) + `</div>
	<div class="edit-form">
		<h2>Edit Entry</h2>
		<form id="editForm">
			<textarea id="content" rows="15">` + html.EscapeString(entry.Content) + `</textarea>
			<input type="text" id="modifiedBy" placeholder="Your Name" required>
			<input type="text" id="summary" placeholder="Summary of changes" required>
			<button type="submit">Save Changes</button>
		</form>
	</div>
	<script>
		document.getElementById('editForm').onsubmit = function(e) {
			e.preventDefault();
			const data = {
				content: document.getElementById('content').value,
				modifiedBy: document.getElementById('modifiedBy').value,
				summary: document.getElementById('summary').value
			};
			fetch('/entries/` + entryID + `', {
				method: 'PUT',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify(data)
			}).then(response => {
				if (response.ok) {
					location.reload();
				} else {
					alert('Error updating entry');
				}
			});
		};
	</script>
</body>
</html>`)

	c.Type("html")
	return c.SendString(htmlBuilder.String())
}

func updateEntry(c *fiber.Ctx) error {
	entryID := c.Params("entryId")
	var updateEntry UpdateEntry
	if err := c.BodyParser(&updateEntry); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if updateEntry.Content == "" || updateEntry.ModifiedBy == "" || updateEntry.Summary == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Content, modifiedBy, and summary are required"})
	}

	var currentContent string
	err := db.QueryRow("SELECT current_content FROM entries WHERE id = ?", entryID).Scan(&currentContent)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	now := time.Now()

	_, err = db.Exec(`
		UPDATE entries 
		SET current_content = ?, last_modified_by = ?, last_modified_at = ?
		WHERE id = ?
	`, updateEntry.Content, updateEntry.ModifiedBy, now, entryID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update entry"})
	}

	_, err = db.Exec(`
		INSERT INTO edits (entry_id, content, modified_by, summary, modified_at, previous_content)
		VALUES (?, ?, ?, ?, ?, ?)
	`, entryID, updateEntry.Content, updateEntry.ModifiedBy, updateEntry.Summary, now, currentContent)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create edit record"})
	}

	var entry Entry
	var title string
	err = db.QueryRow(`
		SELECT id, title, current_content, last_modified_by, last_modified_at
		FROM entries WHERE id = ?
	`, entryID).Scan(&entry.ID, &title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve updated entry"})
	}

	entry.Title = title
	return c.JSON(entry)
}

func getEntryEdits(c *fiber.Ctx) error {
	entryID := c.Params("entryId")

	var title string
	err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Entry not found")
		}
		return c.Status(500).SendString("Internal server error")
	}

	rows, err := db.Query(`
		SELECT id, content, modified_by, summary, modified_at, previous_content
		FROM edits WHERE entry_id = ? ORDER BY modified_at DESC
	`, entryID)
	if err != nil {
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>Edit History: ` + html.EscapeString(title) + `</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 40px; }
		h1 { color: #333; }
		.edit { border: 1px solid #ddd; margin: 20px 0; padding: 20px; }
		.edit-meta { color: #666; margin-bottom: 10px; }
		.diff { background: #f8f8f8; padding: 10px; margin: 10px 0; font-family: monospace; white-space: pre-wrap; }
		.added { background: #d4edda; }
		.removed { background: #f8d7da; }
		.nav-links { margin: 20px 0; }
		.nav-links a { color: #0066cc; text-decoration: none; margin-right: 20px; }
	</style>
</head>
<body>
	<div class="nav-links">
		<a href="/entries">← Back to All Entries</a>
		<a href="/entries/` + html.EscapeString(entryID) + `">← Back to Entry</a>
	</div>
	<h1>Edit History: ` + html.EscapeString(title) + `</h1>`)

	for rows.Next() {
		var edit Edit
		if err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &edit.Summary, &edit.ModifiedAt, &edit.PreviousContent); err != nil {
			return c.Status(500).SendString("Internal server error")
		}

		htmlBuilder.WriteString(`<div class="edit">
			<div class="edit-meta">
				<strong>` + html.EscapeString(edit.ModifiedBy) + `</strong> on ` + edit.ModifiedAt.Format("2006-01-02 15:04:05") + `<br>
				Summary: ` + html.EscapeString(edit.Summary) + `
			</div>`)

		diff := generateDiff(edit.PreviousContent, edit.Content)
		htmlBuilder.WriteString(`<div class="diff">` + diff + `</div>`)

		htmlBuilder.WriteString(`</div>`)
	}

	htmlBuilder.WriteString(`</body>
</html>`)

	c.Type("html")
	return c.SendString(htmlBuilder.String())
}

func generateDiff(oldText, newText string) string {
	if oldText == "" {
		return `<span class="added">+ ` + html.EscapeString(newText) + `</span>`
	}

	oldLines := strings.Split(oldText, "\n")
	newLines := strings.Split(newText, "\n")

	var result strings.Builder

	i, j := 0, 0
	for i < len(oldLines) || j < len(newLines) {
		if i >= len(oldLines) {
			result.WriteString(`<span class="added">+ ` + html.EscapeString(newLines[j]) + `</span>` + "\n")
			j++
		} else if j >= len(newLines) {
			result.WriteString(`<span class="removed">- ` + html.EscapeString(oldLines[i]) + `</span>` + "\n")
			i++
		} else if oldLines[i] == newLines[j] {
			result.WriteString(`  ` + html.EscapeString(oldLines[i]) + "\n")
			i++
			j++
		} else {
			result.WriteString(`<span class="removed">- ` + html.EscapeString(oldLines[i]) + `</span>` + "\n")
			result.WriteString(`<span class="added">+ ` + html.EscapeString(newLines[j]) + `</span>` + "\n")
			i++
			j++
		}
	}

	return result.String()
}