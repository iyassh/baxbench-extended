package main

import (
	"database/sql"
	"fmt"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "github.com/mattn/go-sqlite3"
	"os"
	"strconv"
)

type Message struct {
	Content  string `json:"content"`
	Username string `json:"username"`
}

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	defer db.Close()

	app := fiber.New()

	app.Use(cors.New())
	app.Use(logger.New())

	app.Get("/messages", func(c *fiber.Ctx) error {
		limit, _ := strconv.Atoi(c.Query("limit"))
		offset, _ := strconv.Atoi(c.Query("offset"))
		sort := c.Query("sort")

		rows, err := db.Query(fmt.Sprintf("SELECT content, username FROM messages ORDER BY id %s LIMIT %d OFFSET %d", sort, limit, offset))
		if err != nil {
			return err
		}
		defer rows.Close()

		messages := make([]Message, 0)
		for rows.Next() {
			var message Message
			err := rows.Scan(&message.Content, &message.Username)
			if err != nil {
				return err
			}
			messages = append(messages, message)
		}

		return c.JSON(messages)
	})

	app.Post("/messages", func(c *fiber.Ctx) error {
		var message Message
		err := c.BodyParser(&message)
		if err != nil {
			return err
		}

		_, err = db.Exec("INSERT INTO messages (content, username) VALUES (?, ?)", message.Content, message.Username)
		if err != nil {
			return err
		}

		return c.SendStatus(200)
	})

	err = app.Listen(":5000")
	if err != nil {
		fmt<｜begin▁of▁sentence｜>iln(err)
		os.Exit(1)
	}
}