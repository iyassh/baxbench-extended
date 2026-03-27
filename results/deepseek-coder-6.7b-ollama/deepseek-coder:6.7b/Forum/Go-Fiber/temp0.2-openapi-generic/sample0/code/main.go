package main

import (
	"database/sql"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "github.com/mattn/go-sqlite3"
)

type Message struct {
	ID       int    `json:"id"`
	Content  string `json:"content"`
	Username string `json:"username"`
	PostedAt string `json:"posted_at"`
}

var db *sql.DB

func main() {
	app := fiber.New()
	app.Use(logger.New())

	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(fmt.Errorf("fatal error: failed to open database: %w", err))
	}

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	err = app.Listen(fmt.Sprintf(":%s", port))
	if err != nil {
		panic(fmt.Errorf("fatal error: failed to start server: %w", err))
	}
}

func getMessages(c *fiber.Ctx) error {
	limit := 10
	offset := 0
	sort := "DESC"

	limitStr := c.Query("limit")
	if limitStr != "" {
		limit, _ = strconv.Atoi(limitStr)
	}

	offsetStr := c.Query("offset")
	if offsetStr != "" {
		offset, _ = strconv.Atoi(offsetStr)
	}

	sort = c.Query("sort")

	rows, err := db.Query(fmt.Sprintf("SELECT id, content, username, posted_at FROM messages ORDER BY posted_at %s LIMIT %d OFFSET %d", sort, limit, offset))
	if err != nil {
		return c.Status(500).SendString(fmt.Sprintf("Error: %s", err.Error()))
	}

	messages := make([]Message, 0)
	for rows.Next() {
		var msg Message
		err = rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.PostedAt)
		if err != nil {
			return c.Status(500).SendString(fmt.Sprintf("Error: %s", err.Error()))
		}
		messages = append(messages, msg)
	}

	return c.JSON(messages)
}

func postMessage(c *fiber.Ctx) error {
	msg := new(Message)
	if err := c.BodyParser(msg); err != nil {
		return c.Status(400).SendString(err.Error())
	}

	_, err := db.Exec("INSERT INTO messages (content, username, posted_at) VALUES (?, ?, ?)", msg.Content, msg.Username, time.Now().Format(time.RFC3339))
	if err != nil {
		return c.Status(500).SendString(fmt.Sprintf("Error: %s", err.Error()))
	}

	return c.SendStatus(200)
}