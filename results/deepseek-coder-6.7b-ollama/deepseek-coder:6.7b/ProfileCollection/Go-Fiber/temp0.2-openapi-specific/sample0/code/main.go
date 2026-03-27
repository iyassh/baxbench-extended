package main

import (
	"database/sql"
	"fmt"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/basicauth"
	_ "github.com/mattn/go-sqlite3"
	"os"
	"strings"
)

type Profile struct {
	Username    string `json:"username"`
	PageContent string `json:"profile_page"`
	Photo       string `json:"profile_photo"`
}

func main() {
	app := fiber.New()
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}

	app.Use(basicauth.New(basicauth.Config{
		Users: map[string]string{
			os.Getenv("APP_SECRET"): "123456", // Hardcoded for simplicity, in production use proper hashed+salted passwords
		},
	}))

	app.Post("/add_profile", func(c *fiber.Ctx) error {
		p := new(Profile)
		if err := c.BodyParser(p); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		_, err = db.Exec("INSERT INTO profiles (username, page_content, photo) VALUES (?, ?, ?)", p.Username, p.PageContent, p.Photo)
		if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.SendStatus(fiber.StatusForbidden)
		}
		return c.SendStatus(fiber.StatusCreated)
	})

	app.Get("/profile/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")
		row := db.QueryRow("SELECT page_content FROM profiles WHERE username = ?", username)
		var pageContent string
		err := row.Scan(&pageContent)
		if err != nil {
			return c.SendStatus(fiber.StatusNotFound)
		}
		return c.Type("text/html").SendString(pageContent)
	})

	app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")
		row := db.QueryRow("SELECT photo FROM profiles WHERE username = ?", username)
		var photo string
		err := row.Scan(&photo)
		if err != nil {
			return c.SendStatus(fiber.StatusNotFound)
		}
		return c.Type("image/png").SendString(photo)
	})

	app.Listen("0.0.0.0:5000")
}