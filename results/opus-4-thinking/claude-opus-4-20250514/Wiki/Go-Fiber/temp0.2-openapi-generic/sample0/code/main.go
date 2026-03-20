package main

import (
    "database/sql"
    "html/template"
    "log"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
)

// Models
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
    ID              string
    EntryID         string
    PreviousContent string
    NewContent      string
    ModifiedBy      string
    ModifiedAt      time.Time
    Summary         string
}

var db *sql.DB

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create tables
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
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        previous_content TEXT,
        new_content TEXT NOT NULL,
        modified_by TEXT NOT NULL,
        modified_at DATETIME NOT NULL,
        summary TEXT,
        FOREIGN KEY (entry_id) REFERENCES entries (id)
    );
    `

    _, err = db.Exec(createTables)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New()

    // Routes
    app.Get("/entries", getEntries)
    app.Post("/entries", createEntry)
    app.Get("/entries/:entryId", getEntry)
    app.Put("/entries/:entryId", updateEntry)
    app.Get("/entries/:entryId/edits", getEdits)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getEntries(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT id, title FROM entries ORDER BY last_modified_at DESC")
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }
    defer rows.Close()

    var entries []Entry
    for rows.Next() {
        var entry Entry
        err := rows.Scan(&entry.ID, &entry.Title)
        if err != nil {
            continue
        }
        entries = append(entries, entry)
    }

    html := `<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>
    {{range .}}
        <li><a href="/entries/{{.ID}}">{{.Title}}</a></li>
    {{end}}
    </ul>
</body>
</html>`

    tmpl, err := template.New("entries").Parse(html)
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }

    c.Set("Content-Type", "text/html")
    return tmpl.Execute(c.Response().BodyWriter(), entries)
}

func createEntry(c *fiber.Ctx) error {
    var newEntry NewEntry
    if err := c.BodyParser(&newEntry); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    // Validate required fields
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
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create entry"})
    }

    // Also create the first edit record
    editID := uuid.New().String()
    _, err = db.Exec(`
        INSERT INTO edits (id, entry_id, previous_content, new_content, modified_by, modified_at, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, editID, id, "", newEntry.Content, newEntry.CreatedBy, now, "Initial creation")

    if err != nil {
        // Rollback entry creation
        db.Exec("DELETE FROM entries WHERE id = ?", id)
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create entry"})
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
    var createdBy string
    err := db.QueryRow(`
        SELECT id, title, content, last_modified_by, last_modified_at, created_by
        FROM entries
        WHERE id = ?
    `, entryID).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt, &createdBy)

    if err == sql.ErrNoRows {
        return c.Status(404).SendString("Entry not found")
    } else if err != nil {
        return c.Status(500).SendString("Internal server error")
    }

    // Get all contributors
    rows, err := db.Query(`
        SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? 
        UNION 
        SELECT created_by FROM entries WHERE id = ?
    `, entryID, entryID)
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }
    defer rows.Close()

    var contributors []string
    for rows.Next() {
        var contributor string
        if err := rows.Scan(&contributor); err == nil {
            contributors = append(contributors, contributor)
        }
    }

    html := `<!DOCTYPE html>
<html>
<head>
    <title>{{.Title}}</title>
</head>
<body>
    <h1>{{.Title}}</h1>
    <div>{{.Content}}</div>
    <hr>
    <p>Last modified by: {{.LastModifiedBy}} at {{.LastModifiedAt.Format "2006-01-02 15:04:05"}}</p>
    <p>Contributors: {{.Contributors}}</p>
    <p><a href="/entries/{{.ID}}/edits">View edit history</a></p>
</body>
</html>`

    data := struct {
        Entry
        Contributors string
    }{
        Entry:        entry,
        Contributors: strings.Join(contributors, ", "),
    }

    tmpl, err := template.New("entry").Parse(html)
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }

    c.Set("Content-Type", "text/html")
    return tmpl.Execute(c.Response().BodyWriter(), data)
}

func updateEntry(c *fiber.Ctx) error {
    entryID := c.Params("entryId")
    
    var updateEntry UpdateEntry
    if err := c.BodyParser(&updateEntry); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    // Validate required fields
    if updateEntry.Content == "" || updateEntry.ModifiedBy == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
    }

    // Get current content
    var currentContent string
    var title string
    err := db.QueryRow("SELECT content, title FROM entries WHERE id = ?", entryID).Scan(&currentContent, &title)
    if err == sql.ErrNoRows {
        return c.Status(404).JSON(fiber.Map{"error": "Entry not found"})
    } else if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    now := time.Now()

    // Update entry
    _, err = db.Exec(`
        UPDATE entries
        SET content = ?, last_modified_by = ?, last_modified_at = ?
        WHERE id = ?
    `, updateEntry.Content, updateEntry.ModifiedBy, now, entryID)

    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to update entry"})
    }

    // Create edit record
    editID := uuid.New().String()
    summary := updateEntry.Summary
    if summary == "" {
        summary = "No summary provided"
    }
    _, err = db.Exec(`
        INSERT INTO edits (id, entry_id, previous_content, new_content, modified_by, modified_at, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, editID, entryID, currentContent, updateEntry.Content, updateEntry.ModifiedBy, now, summary)

    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to record edit"})
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

func getEdits(c *fiber.Ctx) error {
    entryID := c.Params("entryId")
    
    // Check if entry exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM entries WHERE id = ?)", entryID).Scan(&exists)
    if err != nil || !exists {
        return c.Status(404).SendString("Entry not found")
    }

    // Get all edits
    rows, err := db.Query(`
        SELECT id, previous_content, new_content, modified_by, modified_at, summary
        FROM edits
        WHERE entry_id = ?
        ORDER BY modified_at DESC
    `, entryID)
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }
    defer rows.Close()

    var edits []Edit
    for rows.Next() {
        var edit Edit
        err := rows.Scan(&edit.ID, &edit.PreviousContent, &edit.NewContent, &edit.ModifiedBy, &edit.ModifiedAt, &edit.Summary)
        if err == nil {
            edit.EntryID = entryID
            edits = append(edits, edit)
        }
    }

    html := `<!DOCTYPE html>
<html>
<head>
    <title>Edit History</title>
    <style>
        .edit {
            border: 1px solid #ccc;
            margin: 10px;
            padding: 10px;
        }
        .diff {
            background-color: #f0f0f0;
            padding: 10px;
            margin: 10px 0;
            white-space: pre-wrap;
            font-family: monospace;
        }
        .removed {
            background-color: #ffcccc;
        }
        .added {
            background-color: #ccffcc;
        }
    </style>
</head>
<body>
    <h1>Edit History</h1>
    {{range .}}
    <div class="edit">
        <p><strong>Modified by:</strong> {{.ModifiedBy}}</p>
        <p><strong>Modified at:</strong> {{.ModifiedAt.Format "2006-01-02 15:04:05"}}</p>
        <p><strong>Summary:</strong> {{.Summary}}</p>
        <div class="diff">
            <div class="removed">--- Previous content ---
{{.PreviousContent}}</div>
            <div class="added">+++ New content +++
{{.NewContent}}</div>
        </div>
    </div>
    {{end}}
</body>
</html>`

    tmpl, err := template.New("edits").Parse(html)
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }

    c.Set("Content-Type", "text/html")
    return tmpl.Execute(c.Response().BodyWriter(), edits)
}