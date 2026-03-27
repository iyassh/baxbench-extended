package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()
	app.Use(logger.New())

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	log.Fatal(app.Listen(fmt.Sprintf(":%s", port)))
}

func addProfile(c *fiber.Ctx) error {
	// Not implemented, as it requires multipart form data parsing and file handling which is complex and beyond the scope of this task
	return fiber.ErrNotImplemented
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")

	row := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username)

	var profilePage string
	err := row.Scan(&profilePage)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.SendStatus(fiber.StatusNotFound)
		}
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.Type("text/html").SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")

	row := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username)

	var profilePhoto []byte
	err :<｜begin▁of▁sentence｜> := row.Scan(&profilePhoto)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.SendStatus(fiber.StatusNotFound)
		}
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.Type("image/png").Send(profilePhoto)
}