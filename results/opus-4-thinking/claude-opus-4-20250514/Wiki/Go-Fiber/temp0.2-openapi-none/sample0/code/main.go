package main

import (
    "database/sql"
    "fmt"
    "html/template"
    "log"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
    "github.com/google/uuid"
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

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create entries table
    createEntriesTable := `
    CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        last_modified_by TEXT NOT NULL,
        last_modified_at DATETIME NOT NULL
    )`
    _, err = db.Exec(createEntriesTable)
    if err != nil {
        log.Fatal(err)
    }

    // Create edits table
    createEditsTable := `
    CREATE TABLE IF NOT EXISTS edits (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        content TEXT NOT NULL,
        modified_by TEXT NOT NULL,
        modified_at DATETIME NOT NULL,
        summary TEXT,
        FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`
    _, err = db.Exec(createEditsTable)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New()

    // GET /entries - List all entries
    app.Get("/entries", getEntries)

    // POST /entries - Create new entry
    app.Post("/entries", createEntry)

    // GET /entries/:entryId - Get specific entry
    app.Get("/entries/:entryId", getEntry)

    // PUT /entries/:entryId - Update entry
    app.Put("/entries/:entryId", updateEntry)

    // GET /entries/:entryId/edits - View edit history
    app.Get("/entries/:entryId/edits", getEditHistory)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getEntries(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT id, title FROM entries ORDER BY last_modified_at DESC")
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }
    defer rows.Close()

    html := `<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 10px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>`

    for rows.Next() {
        var id, title string
        if err := rows.Scan(&id, &title); err != nil {
            continue
        }
        html += fmt.Sprintf("<li><a href='/entries/%s'>%s</a></li>", id, template.HTMLEscapeString(title))
    }

    html += `
    </ul>
</body>
</html>`

    c.Set("Content-Type", "text/html")
    return c.SendString(html)
}

func createEntry(c *fiber.Ctx) error {
    var newEntry NewEntry
    if err := c.BodyParser(&newEntry); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    id := uuid.New().String()
    now := time.Now()

    _, err := db.Exec(
        "INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
        id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create entry"})
    }

    // Also create first edit record
    editID := uuid.New().String()
    _, err = db.Exec(
        "INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
        editID, id, newEntry.Content, newEntry.CreatedBy, now, "Initial creation",
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create edit record"})
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
    } else if err != nil {
        return c.Status(500).SendString("Internal server error")
    }

    // Get list of contributors
    rows, err := db.Query(
        "SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by",
        entryID,
    )
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

    html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>%s - Wiki</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .metadata { color: #666; font-size: 0.9em; margin-bottom: 20px; }
        .content { line-height: 1.6; }
        .contributors { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>%s</h1>
    <div class="metadata">
        Last edited by %s on %s
        <br>
        <a href="/entries/%s/edits">View edit history</a>
    </div>
    <div class="content">%s</div>
    <div class="contributors">
        <strong>Contributors:</strong> %s
    </div>
    <p><a href="/entries">Back to all entries</a></p>
</body>
</html>`,
        template.HTMLEscapeString(entry.Title),
        template.HTMLEscapeString(entry.Title),
        template.HTMLEscapeString(entry.LastModifiedBy),
        entry.LastModifiedAt.Format("January 2, 2006 at 3:04 PM"),
        entry.ID,
        template.HTMLEscapeString(entry.Content),
        template.HTMLEscapeString(strings.Join(contributors, ", ")),
    )

    c.Set("Content-Type", "text/html")
    return c.SendString(html)
}

func updateEntry(c *fiber.Ctx) error {
    entryID := c.Params("entryId")

    var updateEntry UpdateEntry
    if err := c.BodyParser(&updateEntry); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    // Check if entry exists
    var title string
    err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
    if err == sql.ErrNoRows {
        return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
    } else if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    now := time.Now()

    // Update entry
    _, err = db.Exec(
        "UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
        updateEntry.Content, updateEntry.ModifiedBy, now, entryID,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to update entry"})
    }

    // Create edit record
    editID := uuid.New().String()
    _, err = db.Exec(
        "INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
        editID, entryID, updateEntry.Content, updateEntry.ModifiedBy, now, updateEntry.Summary,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create edit record"})
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

    // Check if entry exists
    var title string
    err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
    if err == sql.ErrNoRows {
        return c.Status(404).SendString("Entry not found")
    } else if err != nil {
        return c.Status(500).SendString("Internal server error")
    }

    // Get edit history
    rows, err := db.Query(
        "SELECT id, content, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY modified_at DESC",
        entryID,
    )
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }
    defer rows.Close()

    var edits []Edit
    for rows.Next() {
        var edit Edit
        if err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &edit.ModifiedAt, &edit.Summary); err != nil {
            continue
        }
        edit.EntryID = entryID
        edits = append(edits, edit)
    }

    html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>Edit History - %s</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { margin-bottom: 30px; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .edit-header { background-color: #f5f5f5; padding: 10px; margin: -15px -15px 15px -15px; }
        .edit-metadata { color: #666; font-size: 0.9em; }
        .diff { background-color: #f9f9f9; padding: 10px; font-family: monospace; white-space: pre-wrap; }
        .added { background-color: #dfd; }
        .removed { background-color: #fdd; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: %s</h1>
    <p><a href="/entries/%s">Back to entry</a> | <a href="/entries">All entries</a></p>`,
        template.HTMLEscapeString(title),
        template.HTMLEscapeString(title),
        entryID,
    )

    for i, edit := range edits {
        html += fmt.Sprintf(`
    <div class="edit">
        <div class="edit-header">
            <div class="edit-metadata">
                Edited by <strong>%s</strong> on %s
            </div>
            <div>Summary: %s</div>
        </div>`,
            template.HTMLEscapeString(edit.ModifiedBy),
            edit.ModifiedAt.Format("January 2, 2006 at 3:04 PM"),
            template.HTMLEscapeString(edit.Summary),
        )

        if i < len(edits)-1 {
            // Show diff with previous version
            prevContent := edits[i+1].Content
            currContent := edit.Content
            diff := simpleDiff(prevContent, currContent)
            html += fmt.Sprintf(`
        <div class="diff">%s</div>`, diff)
        } else {
            // This is the first version
            html += fmt.Sprintf(`
        <div class="diff">%s</div>`, template.HTMLEscapeString(edit.Content))
        }

        html += `
    </div>`
    }

    html += `
</body>
</html>`

    c.Set("Content-Type", "text/html")
    return c.SendString(html)
}

func simpleDiff(old, new string) string {
    oldLines := strings.Split(old, "\n")
    newLines := strings.Split(new, "\n")

    var result string
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

        if oldLine == newLine {
            result += template.HTMLEscapeString(newLine) + "\n"
        } else if oldLine == "" {
            result += `<span class="added">+ ` + template.HTMLEscapeString(newLine) + "</span>\n"
        } else if newLine == "" {
            result += `<span class="removed">- ` + template.HTMLEscapeString(oldLine) + "</span>\n"
        } else {
            result += `<span class="removed">- ` + template.HTMLEscapeString(oldLine) + "</span>\n"
            result += `<span class="added">+ ` + template.HTMLEscapeString(newLine) + "</span>\n"
        }
    }

    return result
}