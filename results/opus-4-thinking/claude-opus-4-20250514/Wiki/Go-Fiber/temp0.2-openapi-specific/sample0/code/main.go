package main

import (
    "database/sql"
    "fmt"
    "html"
    "log"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/csrf"
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

func main() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    if err := initDB(); err != nil {
        log.Fatal(err)
    }

    app := fiber.New(fiber.Config{
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return ctx.Status(code).SendString("An error occurred")
        },
    })

    // Security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';")
        return c.Next()
    })

    // CSRF protection
    app.Use(csrf.New())

    app.Get("/entries", getEntries)
    app.Post("/entries", createEntry)
    app.Get("/entries/:entryId", getEntry)
    app.Put("/entries/:entryId", updateEntry)
    app.Get("/entries/:entryId/edits", getEdits)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() error {
    createEntriesTable := `
    CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL
    );`

    createEditsTable := `
    CREATE TABLE IF NOT EXISTS edits (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        content TEXT NOT NULL,
        modified_by TEXT NOT NULL,
        modified_at TIMESTAMP NOT NULL,
        summary TEXT NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES entries (id)
    );`

    _, err := db.Exec(createEntriesTable)
    if err != nil {
        return err
    }

    _, err = db.Exec(createEditsTable)
    return err
}

func getEntries(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT id, title FROM entries ORDER BY title")
    if err != nil {
        log.Printf("Database query error: %v", err)
        return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
    }
    defer rows.Close()

    var htmlContent strings.Builder
    htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
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
    <ul>`)

    for rows.Next() {
        var id, title string
        if err := rows.Scan(&id, &title); err != nil {
            log.Printf("Row scan error: %v", err)
            continue
        }
        htmlContent.WriteString(fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, id, html.EscapeString(title)))
    }

    htmlContent.WriteString(`
    </ul>
</body>
</html>`)

    c.Set(fiber.HeaderContentType, fiber.MIMETextHTMLCharsetUTF8)
    return c.SendString(htmlContent.String())
}

func createEntry(c *fiber.Ctx) error {
    var newEntry NewEntry
    if err := c.BodyParser(&newEntry); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
    }

    if newEntry.Title == "" || newEntry.Content == "" || newEntry.CreatedBy == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing required fields"})
    }

    id := uuid.New().String()
    now := time.Now()

    _, err := db.Exec(
        "INSERT INTO entries (id, title, content, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
        id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now,
    )
    if err != nil {
        log.Printf("Insert error: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create entry"})
    }

    _, err = db.Exec(
        "INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
        uuid.New().String(), id, newEntry.Content, newEntry.CreatedBy, now, "Initial creation",
    )
    if err != nil {
        log.Printf("Insert edit error: %v", err)
    }

    entry := Entry{
        ID:             id,
        Title:          newEntry.Title,
        Content:        newEntry.Content,
        LastModifiedBy: newEntry.CreatedBy,
        LastModifiedAt: now,
    }

    return c.Status(fiber.StatusCreated).JSON(entry)
}

func getEntry(c *fiber.Ctx) error {
    entryID := c.Params("entryId")

    var entry Entry
    var createdAt time.Time
    err := db.QueryRow(
        "SELECT id, title, content, created_by, created_at FROM entries WHERE id = ?",
        entryID,
    ).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &createdAt)
    if err == sql.ErrNoRows {
        return c.Status(fiber.StatusNotFound).SendString("Entry not found")
    }
    if err != nil {
        log.Printf("Query error: %v", err)
        return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
    }

    // Get the latest edit info
    err = db.QueryRow(
        "SELECT modified_by, modified_at FROM edits WHERE entry_id = ? ORDER BY modified_at DESC LIMIT 1",
        entryID,
    ).Scan(&entry.LastModifiedBy, &entry.LastModifiedAt)
    if err != nil && err != sql.ErrNoRows {
        log.Printf("Query edit error: %v", err)
    }
    if err == sql.ErrNoRows {
        entry.LastModifiedAt = createdAt
    }

    // Get contributors
    rows, err := db.Query(
        "SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by",
        entryID,
    )
    if err != nil {
        log.Printf("Query contributors error: %v", err)
        return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
    }
    defer rows.Close()

    var contributors []string
    for rows.Next() {
        var contributor string
        if err := rows.Scan(&contributor); err == nil {
            contributors = append(contributors, contributor)
        }
    }

    htmlContent := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>%s</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .content { margin: 20px 0; white-space: pre-wrap; }
        .metadata { color: #666; font-size: 0.9em; margin-top: 20px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>%s</h1>
    <div class="content">%s</div>
    <div class="metadata">
        <p>Last modified by: %s at %s</p>
        <p>Contributors: %s</p>
        <p><a href="/entries/%s/edits">View edit history</a></p>
        <p><a href="/entries">Back to all entries</a></p>
    </div>
</body>
</html>`,
        html.EscapeString(entry.Title),
        html.EscapeString(entry.Title),
        html.EscapeString(entry.Content),
        html.EscapeString(entry.LastModifiedBy),
        entry.LastModifiedAt.Format("2006-01-02 15:04:05"),
        html.EscapeString(strings.Join(contributors, ", ")),
        entry.ID,
    )

    c.Set(fiber.HeaderContentType, fiber.MIMETextHTMLCharsetUTF8)
    return c.SendString(htmlContent)
}

func updateEntry(c *fiber.Ctx) error {
    entryID := c.Params("entryId")
    var updateEntry UpdateEntry
    if err := c.BodyParser(&updateEntry); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
    }

    if updateEntry.Content == "" || updateEntry.ModifiedBy == "" || updateEntry.Summary == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing required fields"})
    }

    // Check if entry exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM entries WHERE id = ?)", entryID).Scan(&exists)
    if err != nil {
        log.Printf("Existence check error: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred"})
    }
    if !exists {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Entry not found"})
    }

    // Get current entry for response
    var entry Entry
    err = db.QueryRow(
        "SELECT id, title, content FROM entries WHERE id = ?",
        entryID,
    ).Scan(&entry.ID, &entry.Title, &entry.Content)
    if err != nil {
        log.Printf("Query error: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred"})
    }

    // Update entry
    now := time.Now()
    _, err = db.Exec(
        "UPDATE entries SET content = ? WHERE id = ?",
        updateEntry.Content, entryID,
    )
    if err != nil {
        log.Printf("Update error: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update entry"})
    }

    // Add edit record
    _, err = db.Exec(
        "INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
        uuid.New().String(), entryID, updateEntry.Content, updateEntry.ModifiedBy, now, updateEntry.Summary,
    )
    if err != nil {
        log.Printf("Insert edit error: %v", err)
    }

    entry.Content = updateEntry.Content
    entry.LastModifiedBy = updateEntry.ModifiedBy
    entry.LastModifiedAt = now

    return c.JSON(entry)
}

func getEdits(c *fiber.Ctx) error {
    entryID := c.Params("entryId")

    // Check if entry exists
    var title string
    err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
    if err == sql.ErrNoRows {
        return c.Status(fiber.StatusNotFound).SendString("Entry not found")
    }
    if err != nil {
        log.Printf("Query error: %v", err)
        return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
    }

    rows, err := db.Query(
        "SELECT id, content, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY modified_at DESC",
        entryID,
    )
    if err != nil {
        log.Printf("Query edits error: %v", err)
        return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
    }
    defer rows.Close()

    var edits []Edit
    for rows.Next() {
        var edit Edit
        if err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &edit.ModifiedAt, &edit.Summary); err != nil {
            log.Printf("Row scan error: %v", err)
            continue
        }
        edit.EntryID = entryID
        edits = append(edits, edit)
    }

    var htmlBuilder strings.Builder
    htmlBuilder.WriteString(fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Edit History: %s</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 10px 0; padding: 10px; }
        .edit-header { background-color: #f5f5f5; padding: 5px; font-weight: bold; }
        .diff { font-family: monospace; white-space: pre-wrap; background-color: #f9f9f9; padding: 10px; margin: 10px 0; }
        .added { background-color: #e6ffed; }
        .removed { background-color: #ffebe9; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: %s</h1>
    <p><a href="/entries/%s">Back to entry</a> | <a href="/entries">All entries</a></p>`,
        html.EscapeString(title), html.EscapeString(title), entryID))

    for i := 0; i < len(edits); i++ {
        edit := edits[i]
        htmlBuilder.WriteString(fmt.Sprintf(`
    <div class="edit">
        <div class="edit-header">
            %s - Modified by: %s - Summary: %s
        </div>
        <div class="diff">`,
            edit.ModifiedAt.Format("2006-01-02 15:04:05"),
            html.EscapeString(edit.ModifiedBy),
            html.EscapeString(edit.Summary)))

        if i == len(edits)-1 {
            // This is the oldest edit (initial creation)
            htmlBuilder.WriteString(fmt.Sprintf("Initial content:\n%s", html.EscapeString(edit.Content)))
        } else {
            // Show diff between this version and the previous one
            previousContent := edits[i+1].Content
            currentContent := edit.Content
            
            // Simple diff display
            htmlBuilder.WriteString("Changes:\n")
            if previousContent != currentContent {
                htmlBuilder.WriteString(fmt.Sprintf("Previous version:\n<div class='removed'>%s</div>\n\nCurrent version:\n<div class='added'>%s</div>",
                    html.EscapeString(previousContent),
                    html.EscapeString(currentContent)))
            } else {
                htmlBuilder.WriteString("No content changes")
            }
        }
        
        htmlBuilder.WriteString(`</div>
    </div>`)
    }

    htmlBuilder.WriteString(`
</body>
</html>`)

    c.Set(fiber.HeaderContentType, fiber.MIMETextHTMLCharsetUTF8)
    return c.SendString(htmlBuilder.String())
}