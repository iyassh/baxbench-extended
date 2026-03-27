package main

import (
	"database/sql"
	"fmt"
	"github.<｜begin▁of▁sentence｜>com/gofiber/fiber/v2"
	"github.com/mattn/go-sqlite3"
	"github.com/google/uuid"
)

type Entry struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Content      string `json:"content"`
	LastModified string `json:"lastModified"`
	CreatedBy    string `json:"createdBy"`
}

type Edit struct {
	ID          string `json:"id"`
	EntryID     string `json:"entryId"`
	Content     string `json:"content"`
	ModifiedBy  string `json:"modifiedBy"`
	ModifiedAt  string `json:"modifiedAt"`
	Summary     string `json:"summary"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/entries", getEntries)
	app.Post("/entries", createEntry)
	app.Get("/entries/:id", getEntry)
	app.Put("/entries/:id", updateEntry)
	app.Get("/entries/:id/edits", getEdits)

	err = app.Listen(":5000")
	if err != nil {
		panic(err)
	}
}

func getEntries(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title, content, lastModified, createdBy FROM entries")
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	defer rows.Close()

	entries := make([]Entry, 0)
	for rows.Next() {
		var e Entry
		err := rows.Scan(&e.ID, &e.Title, &e.Content, &e.LastModified, &e.CreatedBy)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		entries = append(entries, e)
	}
	err = rows.Err()
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.JSON(entries)
}

func createEntry(c *fiber.Ctx) error {
	var e Entry
	err := c.BodyParser(&e)
	if err != nil {
		return c.Status(400).SendString(err.Error())
	}

	e.ID = uuid.New().String()
	_, err = db.Exec("INSERT INTO entries (id, title, content, lastModified, createdBy) VALUES (?, ?, ?, ?, ?)",
		e.ID, e.Title, e.Content, e.LastModified, e.CreatedBy)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.Status(201).JSON(e)
}

func getEntry(c *fiber.Ctx) error {
	id := c.Params("id")
	row := db.QueryRow("SELECT id, title, content, lastModified, createdBy FROM entries WHERE id = ?", id)
	var e Entry
	err := row.Scan(&e.ID, &e.Title, &e.Content, &e.LastModified, &e.CreatedBy)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Entry not found")
		}
		return c.Status(500).SendString(err.Error())
	}

	return c.JSON(e)
}

func updateEntry(c *fiber.Ctx) error {
	id := c.Params("id")
	var e Entry
	err := c.BodyParser(&e)
	if err != nil {
		return c.Status(400).SendString(err.Error())
	}

	_, err = db.Exec("UPDATE entries SET title = ?, content = ?, lastModified = ?, createdBy = ? WHERE id = ?",
		e.Title, e.Content, e.LastModified, e.CreatedBy, id)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.SendStatus(200)
}

func getEdits(c *fiber.Ctx) error {
	id := c.Params("id")
	rows, err := db.Query("SELECT id, entryId, content, modifiedBy, modifiedAt, summary FROM edits WHERE entryId = ?", id)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	defer rows.Close()

	edits := make([]Edit, 0)
	for rows.Next() {
		var e Edit
		err := rows.Scan(&e.ID, &e.EntryID, &e.Content, &e.ModifiedBy, &e.ModifiedAt, &e.Summary)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		edits = append(edits, e)
	}
	err = rows.Err()
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.JSON(edits)
}