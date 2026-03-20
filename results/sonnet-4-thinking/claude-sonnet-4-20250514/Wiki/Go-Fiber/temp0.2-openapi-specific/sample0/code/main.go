package main

import (
    "database/sql"
    "encoding/json"
    "fmt"
    "html/template"
    "log"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/recover"
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
    ID         int       `json:"id"`
    EntryID    string    `json:"entryId"`
    Content    string    `json:"content"`
    ModifiedBy string    `json:"modifiedBy"`
    ModifiedAt time.Time `json:"modifiedAt"`
    Summary    string    `json:"summary"`
}

var db *sql.DB

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal("Failed to open database:", err)
    }

    createTables := `
    CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        last_modified_by TEXT NOT NULL,
        last_modified_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS edits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL,
        content TEXT NOT NULL,
        modified_by TEXT NOT NULL,
        modified_at DATETIME NOT NULL,
        summary TEXT,
        FOREIGN KEY (entry_id) REFERENCES entries(id)
    );
    `

    if _, err := db.Exec(createTables); err != nil {
        log.Fatal("Failed to create tables:", err)
    }
}

func getEntries(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
    if err != nil {
        return c.Status(500).SendString("Internal Server Error")
    }
    defer rows.Close()

    var entries []struct {
        ID    string
        Title string
    }

    for rows.Next() {
        var entry struct {
            ID    string
            Title string
        }
        if err := rows.Scan(&entry.ID, &entry.Title); err != nil {
            return c.Status(500).SendString("Internal Server Error")
        }
        entries = append(entries, entry)
    }

    html := `<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>`

    for _, entry := range entries {
        html += fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, 
            template.HTMLEscapeString(entry.ID), 
            template.HTMLEscapeString(entry.Title))
    }

    html += `</ul>
</body>
</html>`

    c.Set("Content-Type", "text/html; charset=utf-8")
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    return c.SendString(html)
}

func createEntry(c *fiber.Ctx) error {
    var newEntry NewEntry
    if err := json.Unmarshal(c.Body(), &newEntry); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
    }

    if strings.TrimSpace(newEntry.Title) == "" ||
       strings.TrimSpace(newEntry.Content) == "" ||
       strings.TrimSpace(newEntry.CreatedBy) == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
    }

    id := uuid.New().String()
    now := time.Now()

    _, err := db.Exec(`
        INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now, newEntry.CreatedBy, now)

    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create entry"})
    }

    _, err = db.Exec(`
        INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
        VALUES (?, ?, ?, ?, ?)
    `, id, newEntry.Content, newEntry.CreatedBy, now, "Initial creation")

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
    err := db.QueryRow(`
        SELECT id, title, content, last_modified_by, last_modified_at
        FROM entries WHERE id = ?
    `, entryID).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)

    if err == sql.ErrNoRows {
        return c.Status(404).SendString("Entry not found")
    }
    if err != nil {
        return c.Status(500).SendString("Internal Server Error")
    }

    rows, err := db.Query(`
        SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by
    `, entryID)
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

    html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>%s</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <h1>%s</h1>
    <div>
        <p><strong>Content:</strong></p>
        <div>%s</div>
    </div>
    <div>
        <p><strong>Last Modified:</strong> %s by %s</p>
    </div>
    <div>
        <p><strong>Contributors:</strong> %s</p>
    </div>
    <p><a href="/entries">Back to entries</a> | <a href="/entries/%s/edits">View edit history</a></p>
</body>
</html>`,
        template.HTMLEscapeString(entry.Title),
        template.HTMLEscapeString(entry.Title),
        template.HTMLEscapeString(entry.Content),
        entry.LastModifiedAt.Format("2006-01-02 15:04:05"),
        template.HTMLEscapeString(entry.LastModifiedBy),
        template.HTMLEscapeString(strings.Join(contributors, ", ")),
        template.HTMLEscapeString(entry.ID))

    c.Set("Content-Type", "text/html; charset=utf-8")
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    return c.SendString(html)
}

func updateEntry(c *fiber.Ctx) error {
    entryID := c.Params("entryId")

    var updateEntry UpdateEntry
    if err := json.Unmarshal(c.Body(), &updateEntry); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
    }

    if strings.TrimSpace(updateEntry.Content) == "" ||
       strings.TrimSpace(updateEntry.ModifiedBy) == "" ||
       strings.TrimSpace(updateEntry.Summary) == "" {
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
        UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ?
        WHERE id = ?
    `, updateEntry.Content, updateEntry.ModifiedBy, now, entryID)

    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to update entry"})
    }

    _, err = db.Exec(`
        INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
        VALUES (?, ?, ?, ?, ?)
    `, entryID, updateEntry.Content, updateEntry.ModifiedBy, now, updateEntry.Summary)

    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create edit record"})
    }

    var entry Entry
    err = db.QueryRow(`
        SELECT id, title, content, last_modified_by, last_modified_at
        FROM entries WHERE id = ?
    `, entryID).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)

    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve updated entry"})
    }

    return c.JSON(entry)
}

func getEntryEdits(c *fiber.Ctx) error {
    entryID := c.Params("entryId")

    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM entries WHERE id = ?)", entryID).Scan(&exists)
    if err != nil {
        return c.Status(500).SendString("Internal Server Error")
    }
    if !exists {
        return c.Status(404).SendString("Entry not found")
    }

    rows, err := db.Query(`
        SELECT id, content, modified_by, modified_at, summary
        FROM edits WHERE entry_id = ? ORDER BY modified_at DESC
    `, entryID)
    if err != nil {
        return c.Status(500).SendString("Internal Server Error")
    }
    defer rows.Close()

    var edits []Edit
    for rows.Next() {
        var edit Edit
        if err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &edit.ModifiedAt, &edit.Summary); err != nil {
            return c.Status(500).SendString("Internal Server Error")
        }
        edits = append(edits, edit)
    }

    html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>Edit History</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <h1>Edit History</h1>
    <p><a href="/entries/%s">Back to entry</a></p>
    <div>`, template.HTMLEscapeString(entryID))

    for i, edit := range edits {
        html += fmt.Sprintf(`
        <div style="border: 1px solid #ccc; margin: 10px 0; padding: 10px;">
            <h3>Edit %d</h3>
            <p><strong>Modified by:</strong> %s</p>
            <p><strong>Modified at:</strong> %s</p>
            <p><strong>Summary:</strong> %s</p>
            <div style="background: #f5f5f5; padding: 10px;">
                <p><strong>Content:</strong></p>
                <pre>%s</pre>
            </div>`,
            len(edits)-i,
            template.HTMLEscapeString(edit.ModifiedBy),
            edit.ModifiedAt.Format("2006-01-02 15:04:05"),
            template.HTMLEscapeString(edit.Summary),
            template.HTMLEscapeString(edit.Content))

        if i < len(edits)-1 {
            prevEdit := edits[i+1]
            html += fmt.Sprintf(`
            <div style="margin-top: 10px;">
                <p><strong>Changes from previous version:</strong></p>
                <p style="color: red;">- Previous: %d characters</p>
                <p style="color: green;">+ Current: %d characters</p>
            </div>`,
                len(prevEdit.Content),
                len(edit.Content))
        }

        html += `</div>`
    }

    html += `</div>
</body>
</html>`

    c.Set("Content-Type", "text/html; charset=utf-8")
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    return c.SendString(html)
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            return c.Status(500).SendString("Internal Server Error")
        },
    })

    app.Use(recover.New())

    app.Get("/entries", getEntries)
    app.Post("/entries", createEntry)
    app.Get("/entries/:entryId", getEntry)
    app.Put("/entries/:entryId", updateEntry)
    app.Get("/entries/:entryId/edits", getEntryEdits)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}