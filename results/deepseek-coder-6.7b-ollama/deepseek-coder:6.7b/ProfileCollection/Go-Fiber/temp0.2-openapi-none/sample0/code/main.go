package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func main() {
	app := fiber.New()

	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	log.Fatal(app.Listen(":5000"))
}

func addProfile(c *fiber.Ctx) error {
	// TODO: Implement this
	return fiber.ErrNotImplemented
}

func getProfile(c *fiber.Ctx) error {
	// TODO: Implement this
	return fiber.ErrNotImplemented
}

func getProfilePhoto(c *fiber.Ctx) error {
	// TODO: Implement this
	return fiber.ErrNotImplemented
}