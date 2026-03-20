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
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    createTablesSQL := `
    CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        last_modified_by TEXT NOT NULL,
        last_modified_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS edits (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        content TEXT NOT NULL,
        modified_by TEXT NOT NULL,
        modified_at DATETIME NOT NULL,
        summary TEXT,
        FOREIGN KEY (entry_id) REFERENCES entries(id)
    );`

    _, err = db.Exec(createTablesSQL)
    return err
}

func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';")
    c.Set("X-XSS-Protection", "1; mode=block")
    return c.Next()
}

func main() {
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            message := "Internal Server Error"
            if code == fiber.StatusNotFound {
                message = "Not Found"
            } else if code == fiber.StatusBadRequest {
                message = "Bad Request"
            }
            
            c.Set(fiber.HeaderContentType, fiber.MIMETextPlainCharsetUTF8)
            return c.Status(code).SendString(message)
        },
    })

    app.Use(securityHeaders)

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
        log.Printf("Database query error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }
    defer rows.Close()

    var html strings.Builder
    html.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
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
        escapedTitle := html.EscapeString(title)
        escapedID := html.EscapeString(id)
        html.WriteString(fmt.Sprintf(`<li><a href="/entries/%s">%s</a></li>`, escapedID, escapedTitle))
    }

    html.WriteString(`
    </ul>
</body>
</html>`)

    c.Set(fiber.HeaderContentType, fiber.MIMETextHTMLCharsetUTF8)
    return c.SendString(html.String())
}

func createEntry(c *fiber.Ctx) error {
    var newEntry NewEntry
    if err := c.BodyParser(&newEntry); err != nil {
        return fiber.NewError(fiber.StatusBadRequest)
    }

    if newEntry.Title == "" || newEntry.Content == "" || newEntry.CreatedBy == "" {
        return fiber.NewError(fiber.StatusBadRequest)
    }

    id := uuid.New().String()
    now := time.Now()

    tx, err := db.Begin()
    if err != nil {
        log.Printf("Transaction begin error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }
    defer tx.Rollback()

    _, err = tx.Exec(
        "INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
        id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, now,
    )
    if err != nil {
        log.Printf("Insert entry error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }

    editID := uuid.New().String()
    _, err = tx.Exec(
        "INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
        editID, id, newEntry.Content, newEntry.CreatedBy, now, "Initial creation",
    )
    if err != nil {
        log.Printf("Insert edit error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }

    if err := tx.Commit(); err != nil {
        log.Printf("Transaction commit error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }

    entry := Entry{
        ID:             id,
        Title:          newEntry.Title,
        Content:        newEntry.Content,
        LastModifiedBy: newEntry.CreatedBy,
        LastModifiedAt: now,
    }

    c.Status(fiber.StatusCreated)
    return c.JSON(entry)
}

func getEntry(c *fiber.Ctx) error {
    entryID := c.Params("entryId")
    
    var entry Entry
    
    err := db.QueryRow(
        "SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?",
        entryID,
    ).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
    
    if err == sql.ErrNoRows {
        return fiber.NewError(fiber.StatusNotFound)
    } else if err != nil {
        log.Printf("Query entry error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }

    rows, err := db.Query(
        "SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by",
        entryID,
    )
    if err != nil {
        log.Printf("Query contributors error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }
    defer rows.Close()

    var contributorsList []string
    for rows.Next() {
        var contributor string
        if err := rows.Scan(&contributor); err != nil {
            log.Printf("Scan contributor error: %v", err)
            continue
        }
        contributorsList = append(contributorsList, html.EscapeString(contributor))
    }
    
    contributors := "None"
    if len(contributorsList) > 0 {
        contributors = strings.Join(contributorsList, ", ")
    }

    escapedTitle := html.EscapeString(entry.Title)
    escapedContent := html.EscapeString(entry.Content)
    escapedLastModifiedBy := html.EscapeString(entry.LastModifiedBy)
    
    htmlContent := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>%s - Wiki</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .metadata { color: #666; font-size: 0.9em; margin-bottom: 20px; }
        .content { line-height: 1.6; white-space: pre-wrap; }
        .contributors { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>%s</h1>
    <div class="metadata">
        Last modified by %s on %s
        <br>
        <a href="/entries/%s/edits">View edit history</a>
    </div>
    <div class="content">%s</div>
    <div class="contributors">
        <strong>Contributors:</strong> %s
    </div>
    <div style="margin-top: 20px;">
        <a href="/entries">Back to all entries</a>
    </div>
</body>
</html>`,
        escapedTitle,
        escapedTitle,
        escapedLastModifiedBy,
        entry.LastModifiedAt.Format("January 2, 2006 at 3:04 PM"),
        html.EscapeString(entry.ID),
        escapedContent,
        contributors,
    )

    c.Set(fiber.HeaderContentType, fiber.MIMETextHTMLCharsetUTF8)
    return c.SendString(htmlContent)
}

func updateEntry(c *fiber.Ctx) error {
    entryID := c.Params("entryId")
    
    var updateData UpdateEntry
    if err := c.BodyParser(&updateData); err != nil {
        return fiber.NewError(fiber.StatusBadRequest)
    }

    if updateData.Content == "" || updateData.ModifiedBy == "" || updateData.Summary == "" {
        return fiber.NewError(fiber.StatusBadRequest)
    }

    var existingTitle string
    err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&existingTitle)
    if err == sql.ErrNoRows {
        return fiber.NewError(fiber.StatusNotFound)
    } else if err != nil {
        log.Printf("Query entry error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }

    now := time.Now()

    tx, err := db.Begin()
    if err != nil {
        log.Printf("Transaction begin error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }
    defer tx.Rollback()

    _, err = tx.Exec(
        "UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
        updateData.Content, updateData.ModifiedBy, now, entryID,
    )
    if err != nil {
        log.Printf("Update entry error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }

    editID := uuid.New().String()
    _, err = tx.Exec(
        "INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
        editID, entryID, updateData.Content, updateData.ModifiedBy, now, updateData.Summary,
    )
    if err != nil {
        log.Printf("Insert edit error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }

    if err := tx.Commit(); err != nil {
        log.Printf("Transaction commit error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }

    entry := Entry{
        ID:             entryID,
        Title:          existingTitle,
        Content:        updateData.Content,
        LastModifiedBy: updateData.ModifiedBy,
        LastModifiedAt: now,
    }

    return c.JSON(entry)
}

func getEditHistory(c *fiber.Ctx) error {
    entryID := c.Params("entryId")

    var title string
    err := db.QueryRow("SELECT title FROM entries WHERE id = ?", entryID).Scan(&title)
    if err == sql.ErrNoRows {
        return fiber.NewError(fiber.StatusNotFound)
    } else if err != nil {
        log.Printf("Query entry error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }

    rows, err := db.Query(
        "SELECT id, content, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY modified_at DESC",
        entryID,
    )
    if err != nil {
        log.Printf("Query edits error: %v", err)
        return fiber.NewError(fiber.StatusInternalServerError)
    }
    defer rows.Close()

    var edits []Edit
    for rows.Next() {
        var edit Edit
        if err := rows.Scan(&edit.ID, &edit.Content, &edit.ModifiedBy, &edit.ModifiedAt, &edit.Summary); err != nil {
            log.Printf("Scan edit error: %v", err)
            continue
        }
        edit.EntryID = entryID
        edits = append(edits, edit)
    }

    escapedTitle := html.EscapeString(title)
    
    var htmlContent strings.Builder
    htmlContent.WriteString(fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>Edit History - %s</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .edit { margin-bottom: 30px; padding: 15px; background-color: #f5f5f5; border-radius: 5px; }
        .edit-header { font-weight: bold; margin-bottom: 10px; }
        .edit-summary { color: #666; margin-bottom: 10px; }
        .edit-content { white-space: pre-wrap; background-color: white; padding: 10px; border: 1px solid #ddd; border-radius: 3px; }
        .diff-added { background-color: #d4fdd4; }
        .diff-removed { background-color: #fdd4d4; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: %s</h1>
    <div><a href="/entries/%s">Back to entry</a> | <a href="/entries">All entries</a></div>
    <hr>`, escapedTitle, escapedTitle, html.EscapeString(entryID)))

    var previousContent string
    for i, edit := range edits {
        escapedModifiedBy := html.EscapeString(edit.ModifiedBy)
        escapedSummary := html.EscapeString(edit.Summary)
        escapedContent := html.EscapeString(edit.Content)
        
        htmlContent.WriteString(fmt.Sprintf(`
    <div class="edit">
        <div class="edit-header">
            Edit by %s on %s
        </div>
        <div class="edit-summary">
            Summary: %s
        </div>`, 
            escapedModifiedBy,
            edit.ModifiedAt.Format("January 2, 2006 at 3:04 PM"),
            escapedSummary,
        ))

        if i > 0 && previousContent != "" {
            htmlContent.WriteString(`<div class="edit-diff"><strong>Changes:</strong><br>`)
            
            prevLines := strings.Split(previousContent, "\n")
            currLines := strings.Split(edit.Content, "\n")
            
            maxLines := len(prevLines)
            if len(currLines) > maxLines {
                maxLines = len(currLines)
            }
            
            for j := 0; j < maxLines; j++ {
                var prevLine, currLine string
                if j < len(prevLines) {
                    prevLine = prevLines[j]
                }
                if j < len(currLines) {
                    currLine = currLines[j]
                }
                
                if prevLine != currLine {
                    if prevLine != "" {
                        htmlContent.WriteString(fmt.Sprintf(`<span class="diff-removed">- %s</span><br>`, html.EscapeString(prevLine)))
                    }
                    if currLine != "" {
                        htmlContent.WriteString(fmt.Sprintf(`<span class="diff-added">+ %s</span><br>`, html.EscapeString(currLine)))
                    }
                }
            }
            htmlContent.WriteString(`</div>`)
        }
        
        htmlContent.WriteString(fmt.Sprintf(`
        <div class="edit-content">%s</div>
    </div>`, escapedContent))
        
        previousContent = edit.Content
    }

    htmlContent.WriteString(`
</body>
</html>`)

    c.Set(fiber.HeaderContentType, fiber.MIMETextHTMLCharsetUTF8)
    return c.SendString(htmlContent.String())
}