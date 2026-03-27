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
	"github.com/mattn/go-sqlite3"
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
	// Connect to the SQLite database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create the entries table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS entries (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			last_modified_by TEXT NOT NULL,
			last_modified_at DATETIME NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create the edits table if it doesn't exist
	_, err = db.Exec(`
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
			return c.Status(http.StatusInternalServerError).SendString("Failed to retrieve entries")
		}
		defer rows.Close()

		var entries []Entry
		for rows.Next() {
			var entry Entry
			err = rows.Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Failed to scan entry")
			}
			entries = append(entries, entry)
		}

		return c.JSON(entries)
	})

	// Create a new entry
	app.Post("/entries", func(c *fiber.Ctx) error {
		var newEntry NewEntry
		err := c.BodyParser(&newEntry)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid request body")
		}

		// Generate a new ID for the entry
		id := generateUUID()

		// Insert the new entry into the database
		_, err = db.Exec(`
			INSERT INTO entries (id, title, content, last_modified_by, last_modified_at)
			VALUES (?, ?, ?, ?, ?);
		`, id, newEntry.Title, newEntry.Content, newEntry.CreatedBy, time.Now())
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to create entry")
		}

		// Return the newly created entry
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
		entryId := c.Params("entryId")

		var entry Entry
		err := db.QueryRow("SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?", entryId).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(http.StatusNotFound).SendString("Entry not found")
			}
			return c.Status(http.StatusInternalServerError).SendString("Failed to retrieve entry")
		}

		return c.JSON(entry)
	})

	// Update an existing entry
	app.Put("/entries/:entryId", func(c *fiber.Ctx) error {
		entryId := c.Params("entryId")

		var updateEntry UpdateEntry
		err := c.BodyParser(&updateEntry)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid request body")
		}

		// Check if the entry exists
		var entry Entry
		err = db.QueryRow("SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?", entryId).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(http.StatusNotFound).SendString("Entry not found")
			}
			return c.Status(http.StatusInternalServerError).SendString("Failed to retrieve entry")
		}

		// Insert the edit into the database
		editId := generateUUID()
		_, err = db.Exec(`
			INSERT INTO edits (id, entry_id, modified_by, summary, content, created_at)
			VALUES (?, ?, ?, ?, ?, ?);
		`, editId, entryId, updateEntry.ModifiedBy, updateEntry.Summary, updateEntry.Content, time.Now())
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to create edit")
		}

		// Update the entry in the database
		_, err = db.Exec(`
			UPDATE entries
			SET content = ?, last_modified_by = ?, last_modified_at = ?
			WHERE id = ?;
		`, updateEntry.Content, updateEntry.ModifiedBy, time.Now(), entryId)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to update entry")
		}

		// Return the updated entry
		return c.JSON(Entry{
			ID:          entryId,
			Title:       entry.Title,
			Content:     updateEntry.Content,
			LastModifiedBy: updateEntry.ModifiedBy,
			LastModifiedAt: time.Now(),
		})
	})

	// Get the history of edits for a specific entry
	app.Get("/entries/:entryId/edits", func(c *fiber.Ctx) error {
		entryId := c.Params("entryId")

		// Check if the entry exists
		var entry Entry
		err := db.QueryRow("SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?", entryId).Scan(&entry.ID, &entry.Title, &entry.Content, &entry.LastModifiedBy, &entry.LastModifiedAt)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(http.StatusNotFound).SendString("Entry not found")
			}
			return c.Status(http.StatusInternalServerError).SendString("Failed to retrieve entry")
		}

		rows, err := db.Query("SELECT id, entry_id, modified_by, summary, content, created_at FROM edits WHERE entry_id = ?", entryId)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to retrieve edits")
		}
		defer rows.Close()

		var edits []Edit
		for rows.Next() {
			var edit Edit
			err = rows.Scan(&edit.ID, &edit.EntryID, &edit.ModifiedBy, &edit.Summary, &edit.Content, &edit.CreatedAt)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Failed to scan edit")
			}
			edits = append(edits, edit)
		}

		return c.JSON(edits)
	})

	// Start the Fiber app
	log.Fatal(app.Listen(":5000"))
}

func generateUUID() string {
	uuid := make([]byte, 16)
	_, err := uuid.Read(uuid)
	if err != nil {
		log.Fatal(err)
	}
	uuid[8] = uuid[8]&0xbf // variant bits; see section 4.1.1
	uuid[8] = uuid[8]|0x80 // variant bits; see section 4.1.1
	uuid[6] = uuid[6]&0x0f // version bits; see section 4.1.3
	uuid[6] = uuid[6]|0x40 // version bits; see section 4.1.3
	return fmt.Sprintf("%x-%x-%x-%x-%x", uuid[0:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:])
}