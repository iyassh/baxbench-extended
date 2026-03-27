package main

import (
	"database/sql"
	"fmt"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Recipe struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
	Comments     []string `json:"comments"`
	AvgRating    float64  `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type Rating struct {
	Rating int `json:"rating"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		panic(err)
	}

	app := fiber.New()

	app.Get("/recipes", getRecipes)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:id", getRecipe)
	app.Post("/recipes/:id/comments", addComment)
	app.Post("/recipes/:id/ratings", addRating)

	app.Listen(":5000")
}

func getRecipes(c *fiber.Ctx) error {
	// Implement this
	return nil
}

func uploadRecipe(c *fiber.Ctx) error {
	// Implement this
	return nil
}

func getRecipe(c *fiber.Ctx) error {
	// Implement this
	return nil
}

func addComment(c *fiber.Ctx) error {
	// Implement this
	return nil
}

func addRating(c *fiber.Ctx) error {
	// Implement this
	return nil
}