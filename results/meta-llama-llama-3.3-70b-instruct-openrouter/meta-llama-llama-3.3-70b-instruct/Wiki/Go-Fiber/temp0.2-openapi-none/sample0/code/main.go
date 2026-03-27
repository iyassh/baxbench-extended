package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

// Entry represents a wiki entry
type Entry struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Content     string    `json:"content"`
	LastModifiedBy string    `json:"lastModifiedBy"`
	LastModifiedAt time.Time `json:"lastModifiedAt"`
}

// NewEntry represents a new wiki entry
type NewEntry struct {
	Title    string `json:"title"`
	Content  string `json:"content"`
	CreatedBy string `json:"createdBy"`
}

// UpdateEntry represents an updated wiki entry
type UpdateEntry struct {
	Content  string `json:"content"`
	ModifiedBy string `json:"modifiedBy"`
	Summary  string `json:"summary"`
}

// Edit represents an edit to a wiki entry
type Edit struct {
	ID        string    `json:"id"`
	EntryID   string    `json:"entryId"`
	ModifiedBy string    `json:"modifiedBy"`
	Summary   string    `json:"summary"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

func main() {
	// Connect to the database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create tables if they don't exist
	_, err = db.Exec(`
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
			modified_by TEXT NOT NULL,
			summary TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at DATETIME NOT NULL,
			FOREIGN KEY (entry_id) REFERENCES entries (id)
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Get all entries
	app.Get("/entries", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, title, content, last_modified_by, last_modified_at FROM entries")
		if err != nil {
			return err
		}
		defer rows.Close()

		var entries []Entry
		for rows.Next() {
			var entry Entry
			var lastModifiedAt string
			err = rows.Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &lastModifiedAt)
			if err != nil {
				return err
			}
			entry.LastModifiedAt, err = time.Parse("2006-01-02 15:04:05", lastModifiedAt)
			if err != nil {
				return err
			}
			entries = append(entries, entry)
		}

		return c.JSON(entries)
	})

	// Create a new entry
	app.Post("/entries", func(c *fiber.Ctx) error {
		var newEntry NewEntry
		err := json.Unmarshal(c.Body(), &newEntry)
		if err != nil {
			return err
		}

		id := fmt.Sprintf("%x", time.Now().UnixNano())
		_, err = db.Exec("INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
			id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, time.Now().Format("2006-01-02 15:04:05"))
		if err != nil {
			return err
		}

		return c.Status(http.StatusCreated).JSON(Entry{
			ID:          id,
			Title:       newEntry.Title,
			Content:     newEntry.Content,
			LastModifiedBy: newEntry.CreatedBy,
			LastModifiedAt: time.Now(),
		})
	})

	// Get a specific entry
	app.Get("/entries/:entryId", func(c *fiber.Ctx) error {
		entryID := c.Params("entryId")

		var entry Entry
		var lastModifiedAt string
		err := db.QueryRow("SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?", entryID).
			Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &lastModifiedAt)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(http.StatusNotFound).SendString("Entry not found")
			}
			return err
		}

		entry.LastModifiedAt, err = time.Parse("2006-01-02 15:04:05", lastModifiedAt)
		if err != nil {
			return err
		}

		return c.JSON(entry)
	})

	// Update an existing entry
	app.Put("/entries/:entryId", func(c *fiber.Ctx) error {
		entryID := c.Params("entryId")

		var updateEntry UpdateEntry
		err := json.Unmarshal(c.Body(), &updateEntry)
		if err != nil {
			return err
		}

		// Check if entry exists
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM entries WHERE id = ?", entryID).Scan(&count)
		if err != nil {
			return err
		}
		if count == 0 {
			return c.Status(http.StatusNotFound).SendString("Entry not found")
		}

		// Create a new edit
		editID := fmt.Sprintf("%x", time.Now().UnixNano())
		_, err = db.Exec("INSERT INTO edits (id, entry_id, modified_by, summary, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			editID, entryID, updateEntry.ModifiedBy, updateEntry.Summary, updateEntry.Content, time.Now().Format("2006-01-02 15:04:05"))
		if err != nil {
			return err
		}

		// Update the entry
		_, err = db.Exec("UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
			updateEntry.Content, updateEntry.ModifiedBy, time.Now().Format("2006-01-02 15:04:05"), entryID)
		if err != nil {
			return err
		}

		return c.JSON(Entry{
			ID:          entryID,
			Title:       "", // Title is not updated
			Content:     updateEntry.Content,
			LastModifiedBy: updateEntry.ModifiedBy,
			LastModifiedAt: time.Now(),
		})
	})

	// Get the history of edits for a specific entry
	app.Get("/entries/:entryId/edits", func(c *fiber.Ctx) error {
		entryID := c.Params("entryId")

		rows, err := db.Query("SELECT id, entry_id, modified_by, summary, content, created_at FROM edits WHERE entry_id = ?", entryID)
		if err != nil {
			return err
		}
		defer rows.Close()

		var edits []Edit
		for rows.Next() {
			var edit Edit
			var createdAt string
			err = rows.Scan(&edit.ID, &edit.EntryID, &edit.ModifiedBy, &edit.Summary, &edit.Content, &createdAt)
			if err != nil {
				return err
			}
			edit.CreatedAt, err = time.Parse("2006-01-02 15:04:05", createdAt)
			if err != nil {
				return err
			}
			edits = append(edits, edit)
		}

		return c.JSON(edits)
	})

	log.Fatal(app.Listen(":5000"))
}